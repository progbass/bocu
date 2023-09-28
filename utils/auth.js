const { onAuthStateChanged, signInWithCustomToken } = require('firebase/auth');
const { doc, getDocs, getDoc, query, where, collection } = require('firebase/firestore');
const { auth, db, adminAuth, adminDb } = require('./admin');
const { USER_ROLES, MAX_STRIKES } = require('./app-config');
const { CustomError } = require('./CustomError');

//
exports.isAuthenticated = async (request, response, next) => {
	// Verify that token is present
	if (!request.headers.authorization || !request.headers.authorization.startsWith('Bearer ')) {
		console.error('No token found');
		return next(new CustomError({message: 'Unauthorized', status: 403}));
	}
	
	//const userToken = await userData.user.getIdToken();
	const idToken = request.headers.authorization.split('Bearer ')[1];

	//
	try {
		request.user = await getCurrentUser(auth, idToken);
		return next();
	}
	catch (err) {
		console.error(`${err.code} -  ${err.message}`)
		return next(new CustomError({message: 'Unauthorized', status: 403}));
	}
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

//
const getCurrentUser = async (auth, idToken) => {
	const userToken = await signInWithCustomToken(auth, idToken)//await adminAuth.verifyIdToken(idToken);
	const role = (await userToken.user.getIdTokenResult()).claims?.role;
	
	// Get user data
	const userData = await getUserData(userToken.user.uid);
	return {
		...userData,
		uid: userToken.user.uid,
		token: idToken,
		accessToken: idToken,
		refreshToken: userToken.user.stsTokenManager.refreshToken,
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

//
const getUserData = async userId => {
	// Get User from DB
	const userDB = await getUser(userId);

	// Get user's restaurant
	let userRestaurantsList = await getUserRestaurants(userId);
	const userRestaurants = userRestaurantsList.length ? userRestaurantsList : [];

	// Get user's strikes
	const userStrikes = await adminDb
		.collection('UserStrikes')
		.where('userId', '==', userId)
		.where('discharge', '==', false)
		.get();
	let exceededStrikes = userStrikes.size >= MAX_STRIKES ? true : false;
	const strikes = userStrikes.docs.slice(0, MAX_STRIKES);

	//
	return {
		...userDB,
		restaurants: userRestaurants.map(item => item.id),
		exceededStrikes,
		strikes: strikes.map(doc => {
			return {
				...doc.data(),
				createdAt: doc.data().createdAt.toDate()
			}
		})
	}
}
module.exports.getUserData = getUserData;

const getUser = async userId => {
	const user = await getDoc(
		doc(db, 'Users', userId)
	).catch(err => {
		return err;
	})

	return user ? user.data() : {};
}
const getUserRestaurants = async userId => {
	const userRestaurant = await getDocs(query(
		collection(db, 'Restaurants'),
		where("userId", "==", userId)
	)).catch(err => {
		return err;
	});
	return userRestaurant.size ? userRestaurant.docs : [];
}
module.exports.getUserRestaurants = getUserRestaurants;