const { 
	createUserWithEmailAndPassword, 
	onAuthStateChanged,
	sendEmailVerification
} = require("firebase/auth");
const { auth, db, adminAuth } = require('../utils/admin');
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
	Timestamp
} = require('firebase/firestore')
const dayjs = require("dayjs");
const { user } = require("firebase-functions/v1/auth");

exports.createUser = async (request, response) => {
	createUserWithEmailAndPassword(auth, request.body.email, request.body.password)
		.then(async (userCredential) => {
			// Signed in user
			const user = userCredential.user;

			// Create registry in Users database node
			let userDocumentRef = doc(db, 'Users', user.uid);
			await setDoc(userDocumentRef, {
				authId: user.uid,
				email: user.email,
				createdAt: new Timestamp(dayjs().unix())
			})
			let userDocument = await getDoc(userDocumentRef);

			// Send verification email
			await sendEmailVerification(auth.currentUser);
			
			//
			return response.json({ ...userDocument.data(), ...user.toJSON() });
		})
		.catch((error) => {
			const code = error.code;
			const message = error.message;
			return response.status(409).json({ code, message, type: 'error' });
		});
}
exports.getCurrentUser = async (request, response) => {

	if(request.user){
		//
		console.log(request.user)
		const { stsTokenManager, auth: authObj, reloadListener, reloadUserInfo, proactiveRefresh, ...userData } = request.user;
		return response.json({ 
			...userData, 
			//accessToken: customUserToken,
			//token: customUserToken
		});
	}
	//
	return response.status(409).json({ message: 'User not logged in.', type: 'error' });
}
exports.getUser = async (request, response) => {
	const user = await adminAuth.getUser(request.params.userId)
		.catch(err => {
			return response.status(404).json({ error: 'User not found' })
		});
	//
	if(user){
		// Get Users firestore node
		const userDoc = await getDoc(doc(db, 'Users', user.uid));
		const userNode = userDoc.data() ? userDoc.data() : {};

		//
		return response.json({ ...user.toJSON(), ...userNode });
	}
	//
	return response.status(404).json({ error: 'User not found' });
}
exports.editUser = async (request, response) => {
	const user = await adminAuth.updateUser(request.params.userId, {
		...request.body
	}).catch(err => {
		return response.status(404).json({ error: 'User not found' })
	});

	//
	if(user){
		// Get Users firestore node
		const userDoc = await getDoc(doc(db, 'Users', user.uid));
		const userNode = userDoc.data() ? userDoc.data() : {};

		//
		return response.json({ ...user.toJSON(), ...userNode });
	}
	//
	return response.status(404).json({ error: 'User not found' });

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
}
exports.getUsers = async (request, response) => {
	let usersList = await getDocs(query(
        collection(db, 'Users'),
        orderBy('createdAt', 'desc')
    )).catch((err) => {
        console.error(err);
        return response.status(500).json({
            error: err.code
        });
    });

	if(usersList.docs){
		let userFound;
		const users = [];
		for(const user of usersList.docs){
			let fullProfile = {
				...user.data(),
				id: user.id,
			}

			//
			userFound = true;
			const userAuth = await adminAuth.getUser(user.get('authId'))
				.catch(err => {
					userFound = false;
				});
			if(userFound && userAuth){
				users.push({
					...fullProfile,
					...userAuth.toJSON(),
				})
				continue;
			}
			//
			users.push(fullProfile)
		}

		return response.json(users);
	} else {
        return response.status(204).json({
            error: 'No restaurants were found.'
        });
    }
	
	//
	if(user){
		// Get Users firestore node
		const userDoc = await getDoc(doc(db, 'Users', user.uid));
		const userNode = userDoc.data() ? userDoc.data() : {};

		//
		return response.json({ ...user.toJSON(), ...userNode });
	}
	//
	return response.status(404).json({ error: 'User not found' });
}
exports.deleteUser = async (request, response) => {
	// Get user authId
	const userDoc = doc(db, 'Users', request.params.userId);
	const user = await getDoc(userDoc);

	// Remove user from firestore
	await deleteDoc(userDoc).catch((err) => {
        return response.status(500).json({
            error: err.code
        });
    });

	// Remove from Firebase Authentication module
	const authError = '';
	await adminAuth.deleteUser(user.get('authId')).catch((err) => {
        console.error(err);
		authError = err
        // return response.status(500).json({
        //     error: err.code
        // });
    });

	return response.status(200).json({message: 'Success', error: authError});	
}


exports.getUserDeals = (request, response) => {
	getDocs(query(
		collection(db, 'UserDeals'),
		where("userId", "==", request.params.userId)
	)).then((data) => {
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
	getDocs(query(
		collection(db, 'Restaurants'),
		where("userId", "==", request.params.userId)
	)).then((data) => {
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

// Verify username availability
exports.isUsernameAvailable = async (request, response) => {
	// TODO: Validate for case sensitive.
	let document = await getDocs(query(
		collection(db, 'Users'),
		where('email', '==', `${request.params.email}`)
	)).then(data => {
		if (data.size) {
			return response.json({
				available: false
			});
		} else {
			return response.json({
				available: true
			});
		}
	}).catch((err) => {
		console.error(err);
		return response.status(500).json({
			error: err.code
		});
	});
}

//
exports.claimDeal = (request, response) => {
	// TODO: Validar que el requester no haya realizado un claim anteriormente

	// TODO: Verify number of redemptions

	// Add claim registry
	const newClaim = {

	};
	addDoc(
		collection(db, 'UserDeals'),
		newClaim
	).then((data) => {
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
	updateDoc(
		doc(db, `/UserDeals/`, request.params.dealId),
		newClaim
	).then((data) => {
		return response.json(newClaim);
	})
	.catch((err) => {
		console.error(err);
		return response.status(500).json({ error: err.code });
	});
}

//////////////
exports.getPartnerRestaurant = (request, response) => {
	let document = getDocs(query(
		collection(db, 'Restaurants'),
		where("userId", "==", request.user.uid)
	)).then(data => {
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

