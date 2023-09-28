const isEmpty = (string) => {
	if (string.trim() === '') return true;
	else return false;
};

exports.validateLoginData = (data) => {
   let errors = {};
   if (!data.email || isEmpty(data.email)) errors.email = 'Email no puede estar vacío.';
   if (!data.password || isEmpty(data.password)) errors.password = 'Contraseña no puede estar vacía.';
   return {
       errors,
       valid: Object.keys(errors).length === 0 ? true : false
    };
};

const isEmail = (email) => {
	const emailRegEx = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
	if (email.match(emailRegEx)) return true;
	else return false;
};

exports.validateSignUpData = (data) => {
	let errors = {};

	if (isEmpty(data.email)) {
		errors.email = 'Email no puede estar vacío.';
	} else if (!isEmail(data.email)) {
		errors.email = 'Email inválido.';
	}

	if (isEmpty(data.firstName)) errors.firstName = 'Nombre no puede estar vacío.';
	if (isEmpty(data.lastName)) errors.lastName = 'Apellido no puede estar vacío.';
	if (isEmpty(data.phoneNumber)) errors.phoneNumber = 'Teléfono no puede estar vacío.';
	if (isEmpty(data.country)) errors.country = 'País no puede estar vacío.';

	if (isEmpty(data.password)) errors.password = 'Contraseña no puede estar vacía.';
	if (data.password !== data.confirmPassword) errors.confirmPassword = 'Las contraseñas no coinciden.';
	if (isEmpty(data.username)) errors.username = 'Usuario no puede estar vacío.';

	return {
		errors,
		valid: Object.keys(errors).length === 0 ? true : false
	};
};

const validateName = (name) => {
	// Name validations
	if(name != undefined && name != '' ){
		return true;
	}
	return false;
}
exports.validateName = validateName;

const validateAddress = (address) => {
	// Address validations
	if(address != undefined && address != ''){
		return true
	}
	return false;
}
exports.validateAddress = validateAddress;

const validatePhone = (phone) => {
	// Phone validations
	if(phone != undefined && phone != ''){
		return true
	}
	return false;
}
exports.validatePhone = validatePhone;