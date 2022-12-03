const {
  signInWithEmailAndPassword,
  signOut,
  signInWithCustomToken,
  setPersistence,
  sendPasswordResetEmail,
  sendEmailVerification,
} = require("firebase/auth");
const { getDocs, collection, query, where } = require("firebase/firestore");
const {
  validateLoginData,
  validateSignUpData,
} = require("../utils/validators");
const { auth, adminAuth, db } = require("../utils/admin");
const { getCurrentUser } = require("../utils/auth");
const { CustomError } = require("../utils/CustomError");

const signIn = async (uid) => {
  const customUserToken = await adminAuth.createCustomToken(uid);
  return await getCurrentUser(auth, customUserToken);
};
module.exports.signIn = signIn;
exports.loginUser = async (request, response) => {
  // Retrieve and validate credentials
  let userCredentials = {
    email: request.body?.email ? request.body.email.trim() : "",
    password: request.body?.password,
  };
  const { valid, errors } = validateLoginData(userCredentials);
  if (!valid) return response.status(400).json(errors);

  // Sign in with email/password provider
  await setPersistence(auth, "NONE");
  const userAuth = await signInWithEmailAndPassword(
    auth,
    userCredentials.email,
    userCredentials.password
  ).catch((error) => {
    console.error(error);
    return response.status(403).json({
      err: error,
    });
  });
  //console.loh(userAuth)
  await signOut(auth).catch((error) => {
    console.error(error);
    return response.status(403).json({
      err: error,
    });
  });

  // Sign in user again, but with custom token
  const data = await signIn(userAuth.user.uid).catch((error) => {
    console.error(error);
    return response.status(403).json({
      err: error,
    });
  });
  return response.json(data);
};

exports.logoutUser = async (request, response) => {
  await signOut(auth).catch((error) => {
    console.error(error);
    return response
      .status(403)
      .json({ ...error, message: "Error intentando cerrar la sesión." });
  });

  //
  return response.json({ message: "success" });
};

exports.resetPassword = async (request, response) => {
  await sendPasswordResetEmail(auth, request.params.email)
    .then(() => {
      // Password reset email sent!
      return response.json({ message: "success" });
    })
    .catch((error) => {
      console.error(error);
      return response.status(403).json({
        ...error,
        message: "No se encontró un usuario con este email.",
      });
    });
};

exports.verificateUserEmail = async (request, response) => {
  const user = await adminAuth
    .updateUser(request.params.userId, {
      emailVerified: request.body.validateEmail || false,
    })
    .catch((error) => {
      console.error(error);
      return response
        .status(403)
        .json({ ...error, message: "Error verificando al usuario." });
    });

  //
  console.log(user)
  return response.json({ message: "success" });
};

exports.sendVerificationEmail = async (request, response) => {
  await sendEmailVerification(auth.currentUser).catch((error) => {
    console.error(error);
    return response.status(400).json({
      ...error,
      message: "Usuario no encontrado o no ha iniciado sesión.",
    });
  });

  //
  return response.json({ message: "success" });
};

exports.verifyIdToken = async (request, response) => {
  // Verify token
  const idToken = await adminAuth
    .verifyIdToken(request.body.accessToken)
    .catch((err) => {
      return response.status(403).json({
        ...err,
        message: "Error verificando el token.",
      });
    });

  // Sign in user again, but with custom token
  const user = await signIn(idToken.uid).catch((err) => {
    return response.status(403).json({
      ...err,
      message: "Error verificando el token.",
    });
  });

  //
  return response.status(200).json(user);
};

const getRestaurants = async (userId) => {
  const userRestaurant = await getDocs(
    query(collection(db, "Restaurants"), where("userId", "==", userId))
  ).catch((err) => {
    console.log(err);
    return response.status(500).json(err);
  });
  return userRestaurant.size ? userRestaurant.docs : [];
};
