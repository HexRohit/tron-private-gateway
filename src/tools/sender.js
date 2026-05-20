const axios = require('axios');
const { MongoClient } = require('mongodb');
const https = require('https');
const config = require('../config');

let db;

async function initialize(mongodburi) {
  const client = new MongoClient(mongodburi);

  try {
    await client.connect();
    console.log('sender Connected to MongoDB');
    db = client.db(config.mongoDbName);

    await sendTransactions();
  } catch (err) {
    console.error(err);
  }
}

async function restart() {
  await sendTransactions();
}

const sendTransactions = async () => {
  const transactions = await db.collection('history').find({ status: "Pending" }).toArray();

  if (transactions.length === 0) {
    setTimeout(restart, 5000);
    return;
  }

  const axiosInstance = axios.create({
    httpsAgent: new https.Agent({
      rejectUnauthorized: false,
    }),
  });

  const sendPromises = transactions.map(async (transaction) => {
    try {
      transaction.payload.network = transaction.network;

      const response = await axiosInstance({
        method: 'POST',
        url: transaction.ipnUrl,
        data: transaction.payload,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.status === 200) {
        await db.collection('history').updateOne({ _id: transaction._id }, { $set: { status: "Success" } });
      } else {
        console.error(`Failed with status code: ${response.status}`);
      }
    } catch (error) {
      console.error(error);
      await db.collection('history').updateOne({ _id: transaction._id }, { $set: { status: "Failed"} });
    }
  });

  await Promise.all(sendPromises);
  console.log("Completed total " + transactions.length + " transactions");
  setTimeout(restart, 5000);
};

module.exports = {
  initialize,
};
