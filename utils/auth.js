const { onAuthStateChanged, signInWithCustomToken } = require('firebase/auth');
const { firebase  } = require('firebase-admin')
const { doc, getDocs, getDoc, query, where, collection } = require('firebase/firestore');
const { auth, db, adminAuth } = require('./admin');

exports.isAuthenticated = async (request, response, next) => {
	let userLoaded =  false;
	console.log('Checkoing authentication')

	// Get Auth Id token
	let idToken;
	if (request.headers.authorization && request.headers.authorization.startsWith('Bearer ')) {
		idToken = request.headers.authorization.split('Bearer ')[1];
	} else {
		console.error('No token found');
		return response.status(403).json({ error: 'Unauthorized' });
	} //const userToken = await userData.user.getIdToken();

	await onAuthStateChanged(auth, async userToken => {
		if (userToken && !userLoaded) {
			//request.user = user;
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
};


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
		console.log(err)
		return response.status(500).json(err);
	})

	return user ? user.data() : {};
}
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

exports.isAuthorizated = (opts = { hasRole: [], allowSameUser: true }) => {
	return async (req, res, next) => {
		const roles_list = [
			'super_admin',
			'admin',
			'owner',
			'reader'
		]
		const { role, email, uid } = res.locals;
		const { id } = req.params;

		//const test = adminAuth.verifyIdToken()
		//if (opts.allowSameUser && id && uid === id)
			//return next();
		//if (!role)
			//return res.status(403).send();
 
		const authorized = opts.hasRole.find((role) => {
			return (roles_list.includes(role)) && req.user?.[role] === true
		});
		if (authorized)
			return next();
 
		return res.status(403).send();
	}
}