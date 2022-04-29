require("dotenv").config();

const app = require('firebase-admin');
const { applicationDefault } = require("firebase-admin/app");
const { getDatabase } = require("firebase/database");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const config = require('./config');

//console.log(app)
//const app = initializeApp(config);
//const admin = {};
app.initializeApp({
    credential: applicationDefault(),
    ...config
	//databaseURL: "https://bocu-b909d.firebaseio.com"
});

//
const auth = getAuth(); //app.auth(); //
//const db = {}//getDatabase();
const db = getFirestore();

module.exports = { app, db, auth };