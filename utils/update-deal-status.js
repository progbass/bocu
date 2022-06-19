const { db, app } = require('../utils/admin');
const dayjs = require('dayjs');
var utc = require('dayjs/plugin/utc');
var timezone = require('dayjs/plugin/timezone');

// Dates configuration.
dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.tz.setDefault("America/Mexico_City")

//
exports.updateDealStatus = async (request, response, next) => {
        // Consistent timestamp
        const now = app.firestore.Timestamp.now();

        // Get expired deals
        const dealsCollectionRef = db.collection('Deals')
            .where('expiresAt', '<=', now.toDate())
            .where('active', '==', true);
        const dealsCollection = await dealsCollectionRef.get();
        
        // update deal status
        let docs = dealsCollection.docs;
        for (let doc of docs) {
            await doc.ref.update({active: false});
        }
        
        //
        return
};