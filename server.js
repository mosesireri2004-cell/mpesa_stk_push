const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const axios = require("axios");
const Payment = require("./models/payment");
const path = require("path");

const app = express();

//middlewares
app.use(express.json());
app.use(cors());
app.use(express.urlencoded({ extended: true }));
//app.use(express.static(path.join(__dirname, "frontend")));

dotenv.config();

const port = process.env.PORT || 8080;

app.listen(port, () => {
  console.log(`App is running on localhost:${port}`);
});

//connection to the db
 const db_url = process.env.MONGO_URL;
 mongoose.connect(db_url).then(() => {
    console.log("Database connection successful");
   }).catch((err) => {
 console.log(err.message);
  });

// app.get("/", (req, res) => {
//   res.send("<h1>Hello from backend</h1>");
// });

//app.get("/token", (req,res)=>{
//  generateToken();
//});

async function generateToken(req, res, next) {
  try {
    const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    const consumerKey = process.env.MPESA_CONSUMER_KEY;

    if (!consumerKey || !consumerSecret) {
      return res.status(500).json({
        message: "M-Pesa consumer key or consumer secret missing",
      });
    }

    // const auth = new Buffer.from(`${consumer}:${secret}`).toString("base64");
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString(
      "base64",
    );

    const response = await axios.get(
      "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {
        headers: {
          authorization: `Basic ${auth}`,
        },
        timeout: 36000,
      },
    );
    //  .then((response) => {
    // console.log(response.data.access_token);
    req.token = response.data.access_token;
    next();
    //  });
  } catch (error) {
    console.error("M-Pesa token error:", error.res?.data || error.message);

    return res.status(500).json({
      message: "Failed to generate M-Pesa access token",
      error: error.response?.data || error.message,
    });
  }

  // .catch((err) => {
  //   console.log(err);
  //   // res.status(400).json(err.message);
  // });
}

app.post("/stk", generateToken, async (req, res) => {
  try {
    
    const phone = req.body.phone.substring(1);
    const amount = req.body.amount;

    if (!phone || amount === undefined) {
      return res.status(400).json({
        message: "Phone number and amount are required",
      });
    }

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        message: "Amount must be a valid number greater than 0",
      });
    }

    //let formatPhone = String(phone);

    const date = new Date();
    const timestamp =
      date.getFullYear() +
      ("0" + (date.getMonth() + 1)).slice(-2) +
      ("0" + date.getDate()).slice(-2) +
      ("0" + date.getHours()).slice(-2) +
      ("0" + date.getMinutes()).slice(-2) +
      ("0" + date.getSeconds()).slice(-2);

    const shortcode = process.env.MPESA_PAYBILL;
    const passkey = process.env.MPESA_PASSKEY;

    if (!shortcode || !passkey) {
      return res.status(500).json({
        message: "M-Pesa shortcode or passkey is missing",
      });
    }

    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString(
      "base64",
    );
    // const password = new Buffer.from(shortcode + passkey + timestamp).toString(
    //  "base64",
    //);

    const stkResponse = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      {
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline", // "CustomerBuyGoodsOnline"
        Amount: Math.round(numericAmount),
        PartyA: `254${phone}`,
        //PartyB: shortcode,
        PartyB: shortcode,
        PhoneNumber: `254${phone}`,
        CallBackURL: "https://hangout-expose-lifting.ngrok-free.dev/callback",
        AccountReference: `254${phone}`,
        TransactionDesc: "test",
      },
      {
        headers: {
          Authorization: `Bearer ${req.token}`,
          "Content-Type": "application/json",
        },
        timeout: 36000,
      },
    );

    console.log("STK Push Response:", stkResponse.data);
    return res.status(200).json(stkResponse.data);
  } catch (error) {
    console.error("STK Push error:", error.response?.data || error.message);

    return res.status(500).json({
      message: "STK Push request failed",
      error: error.response?.data || error.message,
    });
  }

  // .then((data) => {
  //   console.log(data.data);
  //   res.status(400).json(data.data);
  // })
  // .catch((err) => {
  //   console.log(err.message);
  //   res.status(400).json(err.message);
  // });
});

app.post("/callback", (req, res) => {
  const callbackData = req.body;

  //console.log(callbackData);
  //console.log(callbackData.Body);

  if (!callbackData.Body.stkCallback.CallbackMetadata) {
    console.log(callbackData.Body);
    return res.json("ok");
  }

  console.log(callbackData.Body.stkCallback.CallbackMetadata);

 const phone = callbackData.Body.stkCallback.CallbackMetadata.Item[4].Value;
  const amount = callbackData.Body.stkCallback.CallbackMetadata.Item[0].Value;
 const transaction_id = callbackData.Body.stkCallback.CallbackMetadata.Item[1].Value;

  //console.log({ phone, amount, transaction_id });

  //saving transactions to the database
   const payment = new Payment();

  payment.number = phone;
  payment.transaction_id = transaction_id;
  payment.amount = amount;

  payment.save().then((data) => {
  console.log({ message: "Saved Successfully", data });
   }).catch((err) => {
  console.log(err.message);
  });
});
