const dayjs = require('dayjs');

// Config
const UTC_OFFSET = -5;

//
exports.isDealValid = (deal) => {
    // Config
    let isValid = false;

    // Is active
    if(!deal.active){
        return false;
    }

    // Number of uses
    if(!deal.useCount >= deal.useMax){
        return false;
    }

    // Check expry date
    const now = dayjs();
    if(now > dayjs.unix(deal.expiresAt.seconds).utcOffset(UTC_OFFSET)){
        return false
    }

    //
    return true;
}