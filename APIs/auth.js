const { 
    signInWithEmailAndPassword, 
    signOut,
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

exports.loginUser = async (request, response) => {
    //
    let userCredentials = {
        email: request.body.email,
		password: request.body.password
	}
	const { valid, errors } = validateLoginData(userCredentials);
	if (!valid) return response.status(400).json(errors);

    // Sign in with email/password provider
    await auth.setPersistence('SESSION');
    const userAuth = await signInWithEmailAndPassword(auth, userCredentials.email, userCredentials.password)
        .catch((error) => {
            console.error(error);
            return response.status(403).json({ general: 'wrong credentials, please try again' });
        })
    //
    // const test = await adminAuth.getUserByEmail('hello@world.com');
    // console.log(test);
    // await adminAuth.setCustomUserClaims(undefined, {
    //     admin: true
    // })

    const customUserToken = await adminAuth.createCustomToken(userAuth.user.uid);
    const { stsTokenManager, auth: authObj, reloadListener, reloadUserInfo, proactiveRefresh, ...userData } = userAuth.user;
    
    // Get user's restaurant
	let userRestaurant = await getRestaurants(userData.uid);
	userRestaurant = userRestaurant.length ? userRestaurant[0].id : null;
    
    return response.json({ 
        ...userData, 
        accessToken: customUserToken,
        token: customUserToken,
        restaurantId: userRestaurant
    });
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
