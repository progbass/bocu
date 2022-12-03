const dayjs = require('dayjs');
const { Timestamp } = require("firebase-admin/firestore");
const { adminDb } = require('../utils/admin');

//
exports.updateDealStatus = async () => {
    // Consistent timestamp
    const now = dayjs();

    // Get expired deals
    const dealsCollectionRef = adminDb.collection('Deals')
        .where('expiresAt', '<', Timestamp.fromDate(now.toDate()))
        .where('active', '==', true);
    const dealsCollection = await dealsCollectionRef.get();
    
    // update deal status
    let docs = dealsCollection.docs;
    for (let doc of docs) {
        await doc.ref.update({active: false});
    }
    
    //
    return docs
};