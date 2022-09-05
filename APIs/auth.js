const { 
    signInWithEmailAndPassword, 
    signOut,
    signInWithCustomToken,
    setPersistence,
    sendPasswordResetEmail,
    sendEmailVerification
} = require("firebase/auth");
const { 
    getDocs, 
    collection, 
    query,
    where
  } = require('firebase/firestore' );
const { validateLoginData, validateSignUpData } = require('../utils/validators');
const { auth, adminAuth, db } = require('../utils/admin');
const { getCurrentUser } = require('../utils/auth');
const { CustomError } = require('../utils/CustomError')

const signIn = async (uid) => {
    const customUserToken = await adminAuth.createCustomToken(uid);
    return await getCurrentUser(auth, customUserToken);
}
module.exports.signIn = signIn;
exports.loginUser = async (request, response) => {
    //
    let userCredentials = {
        email: request.body?.email,
		password: request.body?.password
	}
	const { valid, errors } = validateLoginData(userCredentials);
	if (!valid) return response.status(400).json(errors);

    // Sign in with email/password provider
    await setPersistence(auth, 'NONE');
    const userAuth = await signInWithEmailAndPassword(auth, userCredentials.email, userCredentials.password)
        .catch((error) => {
            //console.error(error);
            throw new CustomError({ status: 403, message: 'Wrong credentials, please try again' });
        })
    
    await signOut(auth);

    // Sign in user again, but with custom token
    const data = await signIn(userAuth.user.uid)
    return response.json(data);
};

exports.logoutUser = async (request, response) => {
    await signOut(auth)
        .catch((error) => {
            console.error(error);
            return response.status(403).json({ general: 'Error closing session, please try again' });
        });

    //
    return response.json({message: 'success'});
};

exports.resetPassword = async (request, response) => {
   await  sendPasswordResetEmail(auth, request.params.email)
    .then(() => {
        // Password reset email sent!
        return response.json({message: 'success'});
    }).catch((error) => {
        console.error(error);
        return response.status(403).json({ general: 'Error sending password rest email.' });
    });
};

exports.verificateUserEmail = async (request, response) => {
    const user = await adminAuth.updateUser(request.params.userId, {
        emailVerified: true
    }).catch((error) => {
        console.error(error);
        return response.status(403).json({ general: 'Error verifying user.' });
    });
    
    //
    return response.json({message: 'success'});
 };

const getRestaurants = async userId => {
	const userRestaurant = await getDocs(query(
		collection(db, 'Restaurants'),
		where("userId", "==", userId)
	)).catch(err => {
		console.log(err)
		return response.status(500).json(err);
	});
	return userRestaurant.size ? userRestaurant.docs : [];
}
