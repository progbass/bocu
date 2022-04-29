var QRCode = require('qrcode')

exports.generateQrCode = (text) => {
    QRCode.toString(text, { type: 'utf8' })
        .then(url => {
            return url
        })
        .catch(err => {
            console.error(err)
            return err
        })
}