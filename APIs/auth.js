const { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword,
    signOut
} = require("firebase/auth");
const config = require("../utils/config")
const { validateLoginData, validateSignUpData } = require('../utils/validators');
const { auth, adminAuth } = require('../utils/admin');
const { connectStorageEmulator } = require("firebase/storage");

exports.loginUser = async (request, response) => {
    //
    let user = {
        email: request.body.email,
		password: request.body.password
	}
	const { valid, errors } = validateLoginData(user);
	if (!valid) return response.status(400).json(errors);

    // Sign in with email/password provider
    const userData = await signInWithEmailAndPassword(auth, user.email, user.password)
        .catch((error) => {
            console.error(error);
            return response.status(403).json({ general: 'wrong credentials, please try again' });
        })
    user = {
        ...user,
        ...userData.user
    }
    // const test = await adminAuth.getUserByEmail(user.email);
    // console.log(test.customClaims)
    // await adminAuth.setCustomUserClaims(user.uid, {
    //     admin: true
    // })

    const token = await userData.user.getIdToken(true);
    return response.json({ ...user, token });
};

exports.logoutUser = async (request, response) => {
    await signOut(auth)
        .catch((error) => {
            console.error(error);
            return response.status(403).json({ general: 'wrong credentials, please try again' });
        });

    //
    return response.json({message: 'success'});
};

exports.createUser = (request, response) => {
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
