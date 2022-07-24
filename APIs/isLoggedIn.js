const { signInWithEmailAndPassword, createUserWithEmailAndPassword } = require("firebase/auth");
const { getAuth } = require("firebase/auth");
const config = require("../utils/config")
const { validateLoginData, validateSignUpData } = require('../utils/validators');
//const { app, auth } = require('../utils/admin');

exports.loginUser = (request, response) => {
    const { initializeApp } = require("firebase/app");
    const firebase = initializeApp(config);
    const auth = getAuth();

    let user = {
        email: request.body.email,
		password: request.body.password
	}
	const { valid, errors } = validateLoginData(user);
	if (!valid) return response.status(400).json(errors);
    //console.log(signInWithEmailAndPassword(auth, user.email, user.password))

    signInWithEmailAndPassword(auth, user.email, user.password)
    .then((data) => {
        user = {
            ...user,
            ...data.user
        }
        return data.user.getIdToken();
    })
    .then((token) => {
        return response.json({ ...user, token });
    })
    .catch((error) => {
        return false;
    })
};

