require("dotenv").config();

const { credential } = require("firebase-admin");
const serviceAccount = require("../service-account-file.json");
const { initializeApp: initializeAdmin } = require("firebase-admin/app");
const { initializeApp } = require("firebase/app");
const { getFirestore: getAdminFirestore } = require("firebase-admin/firestore");
const {
  getFirestore,
  connectFirestoreEmulator,
} = require("firebase/firestore");
const { getStorage } = require("firebase/storage");
const { getAuth: getAdminAuth } = require("firebase-admin/auth");
const { getStorage: getAdminStorage } = require("firebase-admin/storage");
const { getAuth, connectAuthEmulator } = require("firebase/auth");
const { firebaseAppConfig } = require("./config");

// Init admin app. To perform specific operations that require priviliged permissions
const admin = initializeAdmin(
  {
    credential: credential.cert(serviceAccount),
    ...firebaseAppConfig,
  },
  "server"
);

// Standard app (run as 'client-side' to avoid using privileged permissions of the 'admin' SDK)
const app = initializeApp(firebaseAppConfig, "client");

// Get SDKs references
const auth = getAuth(app);
auth.languageCode = "es";
const db = getFirestore(app);
const storage = getStorage(app);
const adminAuth = getAdminAuth(admin);
const adminDb = getAdminFirestore(admin);
const adminStorage = getAdminStorage(admin);

if (process.env.NODE_ENV === "development") {
  connectAuthEmulator(auth, "http://localhost:9099");
  connectFirestoreEmulator(db, "localhost", 8080);
}

// Export objects
module.exports = {
  app,
  db,
  auth,
  storage,
  admin,
  adminDb,
  adminAuth,
  adminStorage,
};
