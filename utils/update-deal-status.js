const dayjs = require('dayjs');
const { Timestamp } = require("firebase-admin/firestore");
const { adminDb } = require('../utils/admin');
const { getNextValidSchedules, createDealObject } = require('../APIs/partners');

//
exports.updateDealStatus = async () => {
    // Consistent timestamp
    const now = dayjs();

    // Get expired deals
    const dealsExpiredCollection = adminDb.collection('Deals')
        .where('active', '==', true)
        .where('expiresAt', '<', now.toDate());
    const dealsExpired = await dealsExpiredCollection.get();
    
    // update deal status
    let deals = dealsExpired.docs;
    for (let deal of deals) {
        // Deactivate deal.
        await deal.ref.update({active: false});

        // If deal was recurrent, create a new one with same settings.
        const isRecurrent = deal.get('isRecurrent');
        if(isRecurrent){
            const newSchedules = getNextValidSchedules(
                dayjs(deal.get('startsAt').toDate()), 
                dayjs(deal.get("expiresAt").toDate())
            );
            const dealClone = await createDealObject(
                newSchedules.nextValidStartDate.toDate(),
                newSchedules.nextValidExpiryDate.toDate(), 
                deal.get('useMax'),
                deal.get('dealType'),
                isRecurrent,
                deal.get('recurrenceSchedules')?.map(schedule => {
                    return {
                        ...schedule,
                        startsAt: newSchedules.nextValidStartDate.toDate(),
                        expiresAt: newSchedules.nextValidExpiryDate.toDate(),
                    }
                }),
                deal.get('userId'),
                deal.get('restaurantId'),
                deal.get('discount'),
                deal.get('include_drinks'),
                deal.get('terms'),
                deal.get('details'),
                true
            ).catch(err => console.log(err));

            let newDeal = await adminDb.collection('Deals').add(dealClone)
              .catch(
              (err) => {
                console.error(err);
                throw new Error("Error al crear la oferta.");
              }
            );
            newDeal = await newDeal.get();
        }
    }
    
    //
    return deals
};