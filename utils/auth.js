const { user } = require('firebase-functions/v1/auth');
const { doc, getDocs, getDoc, query, where, collection } = require('firebase/firestore');
const { app, db, adminAuth } = require('./admin');

exports.isAuthenticated = async (request, response, next) => {
	
	// Get Auth Id token
	let idToken;
	if (request.headers.authorization && request.headers.authorization.startsWith('Bearer ')) {
		idToken = request.headers.authorization.split('Bearer ')[1];
	} else {
		console.error('No token found');
		return response.status(403).json({ error: 'Unauthorized' });
	}

    //
	const decodedToken = await adminAuth.verifyIdToken(idToken)
		.catch((err) => {
			console.error('Error while verifying token', err);
			return response.status(403).json(err);
		});
	request.user = decodedToken;
	const userDBDocument = await getDoc(
		doc(db, `/Users/`, request.user.uid)
	);
	// Set extra properties
	// request.user.id = userDBDocument.docs[0].id;
	// request.user.username = userDBDocument.docs[0].data().username;
	// request.user.imageUrl = userDBDocument.docs[0].data().imageUrl;

	// Get restaurant
	const userRestaurant = await getDocs(query(
		collection(db, 'Restaurants'),
		where("userId", "==", request.user.uid)
	));
	request.user.restaurantId = userRestaurant.docs[0] ? userRestaurant.docs[0].id : null;
	next();
};

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
		//const test = auth.verifyIdToken()
 
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