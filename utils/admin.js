require("dotenv").config();

const app = require('firebase-admin');
const { applicationDefault } = require("firebase-admin/app");
const { getDatabase } = require("firebase/database");
const { connectFirestoreEmulator } = require("firebase/firestore");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const config = require('./config');

app.initializeApp({
    credential: applicationDefault(),
    ...config
	//databaseURL: "https://bocu-b909d.firebaseio.com"
});

//
const auth = getAuth(); //app.auth();

//const db = {}//getDatabase();
const db = getFirestore();

//connectFirestoreEmulator(db, 'localhost', 8080);

module.exports = { app, db, auth };