const dayjs = require('dayjs');
const { Timestamp } = require("firebase-admin/firestore");
const { adminDb } = require('../utils/admin');

//
exports.updateDealStatus = async () => {
    // Consistent timestamp
    const now = dayjs();

    // Get expired deals
    const dealsExpiredCollection = adminDb.collection('Deals')
        .where('active', '==', true)
        .where('isRecurrent', '==', false)
        .where('expiresAt', '<', Timestamp.fromDate(now.toDate()));
    const dealsExpired = await dealsExpiredCollection.get();
    
    // update deal status
    let docs = dealsExpired.docs;
    for (let doc of docs) {
        await doc.ref.update({active: false});
    }
    
    //
    return docs
};