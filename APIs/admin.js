const {
  createUserWithEmailAndPassword,
  sendEmailVerification,
} = require("firebase/auth");
const { auth, db, adminAuth } = require("../utils/admin");
const {
  doc,
  addDoc,
  getDoc,
  setDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  collection,
  orderBy,
  where,
  query,
  limit,
  Timestamp,
} = require("firebase/firestore");
const dayjs = require("dayjs");
const { user } = require("firebase-functions/v1/auth");
const { USER_ROLES, LISTING_CONFIG } = require("../utils/app-config");
const { signIn } = require("./auth");

function handleError(res, err) {
  return res.status(500).send({ message: `${err.code} - ${err.message}` });
}

exports.setUserRole = async (req, res) => {
  try {
    const { uid, role } = req.body;

    // Validate fields
    if (!uid) {
      return res.status(400).send({ message: "Missing user ID." });
    }
    if (!role || !Object.values(USER_ROLES).includes(role)) {
      return res.status(400).send({ message: "User role not defined." });
    }

    // Define user role in firebase Auth
    await adminAuth.setCustomUserClaims(uid, { role });

    // Resturn modified user
    const userAuth = await adminAuth.getUser(uid);
    return res.json({
      ...userAuth.toJSON(),
    });
  } catch (err) {
    return handleError(res, err);
  }
};
exports.editUser = async (request, response) => {
  const user = await adminAuth
    .updateUser(request.params.userId, {
      ...request.body,
    })
    .catch((err) => {
      return response.status(404).json({ error: "User not found" });
    });

  //
  if (user) {
    // Get Users firestore node
    const userDoc = await getDoc(doc(db, "Users", user.uid));
    const userNode = userDoc.data() ? userDoc.data() : {};

    //
    return response.json({ ...user.toJSON(), ...userNode });
  }
  //
  return response.status(404).json({ error: "User not found" });

  // updateDoc(
  // 	doc(db, `/Users/`, request.params.userId),
  // 	request.body
  // ).then((doc) => {
  // 		response.json({message: 'Updated successfully'});
  // 	})
  // 	.catch((err) => {
  // 		console.error(error);
  // 		return response.status(500).json({
  // 			message: "Cannot Update the value"
  // 		});
  // 	});
};
exports.deleteUser = async (request, response) => {
  // Get user authId
  const userDoc = doc(db, "Users", request.params.userId);
  const user = await getDoc(userDoc);

  // Remove user from firestore
  await deleteDoc(userDoc).catch((err) => {
    return response.status(500).json({
      error: err.code,
    });
  });

  // Remove from Firebase Authentication module
  const authError = "";

  try {
    await adminAuth.deleteUser(user.get("authId"));
  } catch (err) {
    console.error(err);
    authError = err;
    // return response.status(500).json({
    //     error: err.code
    // });
  }

  return response.status(200).json({ message: "Success", error: authError });
};
