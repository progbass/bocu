const { getAuth, updateProfile, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged } = require("firebase/auth");
const config = require('../utils/config');
const { auth, db, app } = require('../utils/admin');
const { validateLoginData, validateSignUpData } = require('../utils/validators');

exports.createUser = (request, response) => {
	const { initializeApp } = require("firebase/app");
    const firebase = initializeApp(config);
    const auth = getAuth(firebase);

	createUserWithEmailAndPassword(auth, request.body.email, request.body.password)
		.then((userCredential) => {
			// Signed in 
			const user = userCredential.user;
			return response.json({ ...user });
		})
		.catch((error) => {
			const code = error.code;
			const message = error.message;
			return response.status(409).json({ code, message, type: 'error' });
		});
}
exports.getCurrentUser = (request, response) => {
	auth.getUser(request.user.uid)
	.then((userRecord) => {
	  // See the UserRecord reference doc for the contents of userRecord.
	  return response.json(userRecord.toJSON());
	})
	.catch((error) => {
	  return response.status(409).json({ message: 'user not logged in.', type: 'error' });
	});
}
exports.getUser = (request, response) => {
	db
		.doc(`/Users/${request.params.userId}`)
		.get()
		.then((doc) => {
			if (doc.exists) {
				//userData.userCredentials = doc.data();
				return response.json({ ...doc.data() });
			}
		})
		.catch((err) => {
			console.error(err);
			return response.status(500).json({ error: err.code });
		});
}
exports.editUser = (request, response) => {
	//const auth = getAuth();
	updateProfile(auth.currentUser, request.body)
		.then(() => {
			response.json({ message: 'Updated successfully' });
		}).catch((error) => {
			console.error(error);
			return response.status(500).json({
				message: "Cannot Update the value"
			});
		});
	// db
	// 	.doc(`/Users/${request.params.userId}`)
	// 	.update(request.body)
	// 	.then((doc) => {
	// 		response.json({message: 'Updated successfully'});
	// 	})
	// 	.catch((err) => {
	// 		console.error(error);
	// 		return response.status(500).json({ 
	// 			message: "Cannot Update the value"
	// 		});
	// 	});
}
exports.getUserFavorites = (request, response) => {
	db
		.collection('UserFavorites')
		//.orderBy('createdAt', 'desc')
		.where("userId", "==", request.params.userId)
		.get()
		.then((data) => {
			let todos = [];
			data.forEach((doc) => {
				todos.push({
					id: doc.id,
					restaurantId: doc.data().userId,
					userId: doc.data().restaurantId
				});
			});
			return response.json(todos);
		})
		.catch((err) => {
			console.error(err);
			return response.status(500).json({ error: err.code });
		});
}
exports.getUserDeals = (request, response) => {
	db
		.collection('UserDeals')
		.where("userId", "==", request.params.userId)
		.get()
		.then((data) => {
			let todos = [];
			data.forEach((doc) => {
				todos.push({
					id: doc.id,
					limit: doc.data().limit,
					dealId: doc.data().dealId,
					redeemed: doc.data().redeemed,
					userId: doc.data().restaurantId,
					createdAt: doc.data().createdAt
				});
			});
			return response.json(todos);
		})
		.catch((err) => {
			console.error(err);
			return response.status(500).json({ error: err.code });
		});
}
exports.getUserRestaurants = (request, response) => {
	db
		.collection('Restaurants')
		.where("userId", "==", request.params.userId)
		.get()
		.then((data) => {
			let restaurants = [];
			data.forEach((doc) => {
				restaurants.push({
					id: doc.id,
					...doc.data()
				});
			});
			//return response.json(restaurants);
			return response.json(restaurants[0]);
		})
		.catch((err) => {
			console.error(err);
			return response.status(500).json({ error: err.code });
		});
}


exports.claimDeal = (request, response) => {
	// TODO: Validar que el requester no haya realizado un claim anteriormente

	// TODO: Verify number of redemptions

	// Add claim registry
	const newClaim = {

	};
	db
		.collection('UserDeals')
		.add(newClaim)
		.then((data) => {
			return response.json(newClaim);
		})
		.catch((err) => {
			console.error(err);
			return response.status(500).json({ error: err.code });
		});
}
exports.redeemDeal = (request, response) => {
	// TODO: Validar que el usuario sea el requester

	// TODO: Verify number of redemptions

	// Redeem claim
	const newClaim = {
		...request.body,
		redeemed: true
	};
	db
		.doc(`/UserDeals/${request.params.dealId}`)
		.update(newClaim)
		.then((data) => {
			return response.json(newClaim);
		})
		.catch((err) => {
			console.error(err);
			return response.status(500).json({ error: err.code });
		});
}

// Verify username availability
exports.isUsernameAvailable = (request, response) => {
	// TODO: Validate for case sensitive.
	let document = db.collection('Users')
		.where('email', '==', `${request.params.email}`)
		.get()
		.then(data => {
			if (data.size) {
				return response.json({
					available: false
				});
			} else {
				return response.json({
					available: true
				});
			}
		})
		.catch((err) => {
			console.error(err);
			return response.status(500).json({
				error: err.code
			});
		});
}


// read qr


//////////////
exports.getPartnerRestaurant = (request, response) => {
	
	let document = db.collection('Restaurants')
		.where("userId", "==", request.user.uid)
		.get()
		.then(data => {

			if (data.size < 1) {
				return response.status(404).json({
					error: 'no results'
				});
			}

			//
			let restaurants = {};
			let i = 0;
			data.forEach((doc) => {
				// only get first restaurant
				if (i == 0) {
					restaurants = {
						id: doc.id,
						...doc.data()
					};
				}
				i++;
			});

			//
			return response.json(restaurants);
		})
		.catch((err) => {
			console.error(err);
			return response.status(500).json({
				error: err.code
			});
		});
}

