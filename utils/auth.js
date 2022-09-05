const { onAuthStateChanged, signInWithCustomToken } = require('firebase/auth');
const { doc, getDocs, getDoc, query, where, collection } = require('firebase/firestore');
const { auth, db, adminAuth } = require('./admin');
const { USER_ROLES } = require('./app-config');
const { CustomError } = require('./CustomError');

exports.isAuthenticated = async (request, response, next) => {
	

	// Verify that token is present
	if (!request.headers.authorization || !request.headers.authorization.startsWith('Bearer ')) {
		console.error('No token found');
		return next(new CustomError({message: 'Unauthorized', status: 403}));
	}
	
	//const userToken = await userData.user.getIdToken();
	const idToken = request.headers.authorization.split('Bearer ')[1];

	try {
		request.user = await getCurrentUser(auth, idToken);
		return next();
	}
	catch (err) {
		console.error(`${err.code} -  ${err.message}`)
		return next(new CustomError({message: 'Unauthorized', status: 403}));
	}

	/*
	let userLoaded =  false;
	await onAuthStateChanged(auth, async userToken => {
		if (userToken && !userLoaded) {
			userLoaded = true;

			// Get user data
			const userData = await formatUserData(userToken.uid);
			request.user = {
				...userToken,
				...userData
			} 
			
			//
			next();
		} else if(!userLoaded) {
			userLoaded = true;

			// Try to login with the custom access token
			await signInWithCustomToken(auth, idToken)
				.then(async userToken => {
					//request.user = userToken.user;

					// Get user data
					const userData = await formatUserData(userToken.user.uid);
					request.user = {
						...userToken.user,
						...userData
					} 

					//
					next();
				})
				.catch(err =>{
					// User is signed out
					console.error(err);
					return response.status(403).json({ error: 'User not logged in.' });
				})
		}
	});
    //
	*/
};

exports.isAuthorizated = (opts = { hasRole: [], allowSameUser: true }) => {
	return async (req, res, next) => {
		const roles_list = [
			USER_ROLES.SUPER_ADMIN,
			USER_ROLES.ADMIN,
			USER_ROLES.PARTNER,
			USER_ROLES.CUSTOMER
		]

		//if (opts.allowSameUser && id && uid === id)
			//return next();
		//if (!role)
			//return res.status(403).send();
 
		const authorized = opts.hasRole.find((role) => {
			return (roles_list.includes(role)) && req.user?.role === role
		});
		if (authorized)
			return next();
 
		return res.status(403).send();
	}
}
const getCurrentUser = async (auth, idToken) => {
	const userToken = await signInWithCustomToken(auth, idToken)//await adminAuth.verifyIdToken(idToken);
	const role = (await userToken.user.getIdTokenResult()).claims?.role;
	
	// Get user data
	const userData = await formatUserData(userToken.user.uid);
	return {
		...userData,
		uid: userToken.user.uid,
		token: idToken,
		accessToken: idToken,
		displayName: userToken.user.displayName,
		email: userToken.user.email,
		emailVerified: userToken.user.emailVerified,
		phoneNumber: userToken.user.phoneNumber,
		photoURL: userToken.user.photoURL,
		isAnonymous: userToken.user.isAnonymous,
		tenantId: userToken.user.tenantId,
		providerData: userToken.user.providerData,
		metadata: userToken.user.metadata,
		role
	} 
}
module.exports.getCurrentUser = getCurrentUser;
const formatUserData = async userId => {
	// Get User from DB
	const userDB = await getUser(userId);

	// Get user's restaurant
	let userRestaurant = await getRestaurants(userId);
	userRestaurant = userRestaurant.length ? userRestaurant[0].id : null;

	return {
		...userDB,
		restaurantId: userRestaurant
	}
}
const getUser = async userId => {
	const user = await getDoc(
		doc(db, 'Users', userId)
	).catch(err => {
		return err;
	})

	return user ? user.data() : {};
}
const getRestaurants = async userId => {
	const userRestaurant = await getDocs(query(
		collection(db, 'Restaurants'),
		where("userId", "==", userId)
	)).catch(err => {
		return err;
	});
	return userRestaurant.size ? userRestaurant.docs : [];
}
