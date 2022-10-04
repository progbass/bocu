const path = require("path");
const os = require("os");
const fs = require("fs");
const sharp = require("sharp");
const { adminStorage } = require("../utils/admin");
const { toFile } = require("qrcode");
const { connectStorageEmulator } = require("firebase/storage");

//
exports.uploadFiletoBucket = async (file, info, destinationPath) => {
  const { filename, mimeType } = info;

  // Get file extension and define new name
  const imageExtension = filename.split(".")[filename.split(".").length - 1];
  const imageName = `${new Date().toISOString()}`;
  let imageFileName = `${imageName}.${imageExtension}`;
  const filePath = path.join(os.tmpdir());

  // Create reference object to access information from async events
  let imageToBeUploaded = { filePath, mimeType, imageFileName, imageName };

  // Create file write stream
  const writeStream = fs.createWriteStream(`${filePath}/${imageFileName}`);
  file.pipe(writeStream);
  file.on("end", () => {
    writeStream.end();
  });
  file.on("error", function (err) {
    // Error processing the file
    console.error("File error >>>>:", err);
  });

  // Create a promise that resolves when the write finishes
  return new Promise((resolve, reject) => {
    writeStream.on("finish", async () => {
      const fileURLs = [];
      const resizedImages = await resizeImage(
        500,
        500,
        imageToBeUploaded.filePath,
        imageToBeUploaded.imageName,
        imageToBeUploaded.imageFileName,
      ).catch((err) => {});

      //
      await Promise.all(resizedImages).then(async (values) => {
        const bucket = adminStorage.bucket();
        for (const image of values) {
          const destination = `${destinationPath}/${image.fileName}`;

          // Upload to Firebase Storage
          await bucket
            .upload(`${image.filePath}/${image.fileName}`, {
              resumable: false,
              public: true,
              destination,
              metadata: {
                metadata: {
                  contentType: imageToBeUploaded.mimetype,
                },
              },
            })
            .catch((error) => {
              reject(error);
            });

          // Save file and retrieve public URL.
          const file = await bucket.file(destination);
          const publicUrl = await file.publicUrl();
          fileURLs.push({
            fileURL: publicUrl,
            keyName: image.keyName,
          });
        }
      });

      // Resolve promise
      resolve(fileURLs);
    });

    writeStream.on("error", (err) => {
      console.error("Stream Err >>>>:", err);
      reject(err);
    });
  });
};

//
const getMetadata = async (filePath) => {
  try {
    const metadata = await sharp(filePath).metadata();
  } catch (error) {
    console.log(`An error occurred during processing: ${error}`);
  }
};
exports.getMetadata = getMetadata;

//
const ImageTypes = [
  {
    name: "landscape",
    size: 750,
  },
  {
    name: "blur_bg",
    size: 750,
  },
  {
    name: "square",
    size: 110,
  },
];
const resizeImage = async (
  width,
  height,
  filePath,
  imageName,
  imageFileName
) => {
  try {
    const images = [];

    //'
    for (let { name, size } of ImageTypes) {
      const source = sharp(`${filePath}/${imageFileName}`);
      

      if (name === "square") {
        source.resize(size, size, { fit: "cover" });
      }

      if (name === "landscape") {
        source.resize(size, null, { fit: "cover" });
        source.extract({ left: 0, top: 0, width: size, height: 250 });
      }

      if (name === "blur_bg") {
        source.resize(size, null, { fit: "cover" });
        source.extract({ left: 0, top: 0, width: size, height: 250 });
        source.blur(12);
      }

      //
      let keyName;
      switch (name) {
        case "blur_bg":
          keyName = "cover";
          break;
        case "square":
          keyName = "avatar";
          break;
        default:
          keyName = "photo";
          break;
      }

      const destinationImage = `${imageName}_${name}.jpg`;
      images.push(
        new Promise((resolve, reject) => {
          source
            .toFormat("jpg", { quality: 100 }) // mozjpeg: true
            .toFile(path.join(os.tmpdir(), destinationImage))
            .then((data) =>
              resolve({
                ...data,
                filePath: `${filePath}`,
                fileName: `${destinationImage}`,
                keyName
              })
            )
            .catch((err) => reject(err));
        })
      );
    }

    //
    return images;
  } catch (error) {
    console.log(error);
  }
};
exports.resizeImage = resizeImage;

//
const cropImage = async () => {
  try {
    await sharp("sammy.png")
      .extract({ width: 500, height: 330, left: 120, top: 70 })
      .toFile("sammy-cropped.png");
  } catch (error) {
    console.log(error);
  }
};
exports.cropImage = cropImage;
