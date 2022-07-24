require("dotenv").config();

const { initializeApp: initializeAdmin, applicationDefault } = require('firebase-admin/app');
const { initializeApp } = require("firebase/app");
const { getFirestore } = require('firebase/firestore');
const { getStorage } = require('firebase/storage');
const { getAuth: getAdminAuth } = require("firebase-admin/auth");
const { getAuth } = require("firebase/auth");
const config = require('./config');

// Init admin app. To perform specific operations that require priviliged permissions
const admin = initializeAdmin({
    credential: applicationDefault(),
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    storageBucket: config.storageBucket,
    messagingSenderId: config.messagingSenderId,
    appId: config.appId,
    measurementId: config.measurementId,
    databaseURL: config.databaseURL
})

// Standard app (run as 'client-side' to avoid using privileged permissions of the 'admin' SDK)
const app = initializeApp({
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    storageBucket: config.storageBucket,
    messagingSenderId: config.messagingSenderId,
    appId: config.appId,
    measurementId: config.measurementId,
    databaseURL: config.databaseURL
});

// Get SDKs references
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const adminAuth = getAdminAuth(admin);

// Export objects
module.exports = { app, db, auth, storage, admin, adminAuth };