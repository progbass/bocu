const { validateAddress, validateName, validatePhone } = require('./validators');


const getMissingRequirements = (restaurant) => {
    const requiredValidations = [{
      operation: validateAddress,
      field: 'address',
      args: [restaurant.address],
      error: 'Dirección obligatoria.',
    }, {
      operation: validateName,
      field: 'name',
      args: [restaurant.name],
      error: 'Nombre del restaurante obligatorio.',
    }, {
      operation: validatePhone,
      field: 'phone',
      args: [restaurant.phone],
      error: 'Teléfono de contacto obligatorio.',
    }]
  
    // Execute validations and get detils on missing information
    const missingRequirements = requiredValidations.reduce((requirements, validation) => {
      if(!validation.operation(...validation.args)){
        return [...requirements, {
          missingField: validation.field,
          message: validation.error
        }];
      }
  
      return requirements
    }, []);
  
    //
    return missingRequirements;
}
exports.getMissingRequirements = getMissingRequirements;

const hasMissingRequirements = (restaurant) => {
    return getMissingRequirements(restaurant).length > 0;
}
exports.hasMissingRequirements = hasMissingRequirements;

exports.generateQR = async (restaurantId, bucket) => {
  const { uploadString } = require("firebase/storage");
  //const stg = ref(storage);

  // generate QR code
  var QRCode = require("qrcode");
  const qrCode = await QRCode.toDataURL(restaurantId, {
    scale: 20,
    color: { dark: "#E53E3A" },
  });

  // upload QR to bucket
  const metadata = {
    public: true,
    resumable: false,
    metadata: { contentType: base64MimeType(qrCode) || "" },
    validation: false,
  };

  //const bucket = stg.bucket(config.storageBucket);
  //const file = bucket.file(path);
  const base64EncodedString = qrCode.replace(/^data:\w+\/\w+;base64,/, "");
  //const fileBuffer = Buffer.from(base64EncodedString, "base64");
  return uploadString(bucket, base64EncodedString, 'base64', metadata); //file.save(fileBuffer, metadata);
  //upload.ref.bucket.ge
  //return file.publicUrl();
};
const base64MimeType = (encoded) => {
  var result = null;

  if (typeof encoded !== "string") {
    return result;
  }

  var mime = encoded.match(/data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+).*,.*/);

  if (mime && mime.length) {
    result = mime[1];
  }

  return result;
};