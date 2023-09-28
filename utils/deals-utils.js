const dayjs = require("dayjs");

// Config
exports.DEAL_EXPIRY_DEFAULT_OFFSET_HOURS = 2;
const DEAL_USAGE_ILIMITED = -1;
exports.DEAL_USAGE_ILIMITED = DEAL_USAGE_ILIMITED;
const DEAL_TYPE = {
  DISCOUNT: 1,
  PROMOTION: 2,
  FREE: 'FREE',
  DISCOUNT_AMOUNT: 'DISCOUNT_AMOUNT',
}
exports.DEAL_TYPE = DEAL_TYPE;
const DEAL_FREQUENCY_TYPE = {
  SINGLE_DATE: 'SINGLE_DATE',
  RECURRENT: 'RECURRENT',
}
exports.DEAL_FREQUENCY_TYPE = DEAL_FREQUENCY_TYPE;


exports.isDealActive = (deal) => {
  // Verify that deal is valid
  if (!isDealValid(deal)) {
    return false;
  }

  // Is active
  if (!deal.active) {
    return false;
  }

  // Number of uses
  if (!doesDealHasRedemptionUsage(deal)) {
    return false;
  }

  // If deal is not recurrent, check if it is expired
  if(!deal.isRecurrent){
    const now = dayjs();
    if (now.isAfter(deal.expiresAt.toDate())) {
      return false;
    }
  }

  // If deal is recurrent, check if it has schedules
  if(deal.isRecurrent){
    if(!hasRecurrenceSchedules(deal)){
      return false;
    }
  }

  // Deal is considered as active and valid
  return true;
};

const isDealRecurrent = (deal) => {
  return deal.isRecurrent;
}
exports.isDealRecurrent = isDealRecurrent;

// Checks if deal has remaining uses
const doesDealHasRedemptionUsage = (deal) => {
  if (deal.useMax != DEAL_USAGE_ILIMITED) {
    if (deal.useCount >= deal.useMax) {
      return false;
    }
  }

  return true;
};
exports.doesDealHasRedemptionUsage = doesDealHasRedemptionUsage;

// Checks id deal has minimun required information
const isDealValid = (deal) => {
  // Check that deal has minimum required information
  // and dates are valid.
  if (
    !dayjs.unix(deal.startsAt?.seconds).isValid() ||
    !dayjs.unix(deal.expiresAt?.seconds).isValid() ||
    !dayjs.unix(deal.createdAt?.seconds).isValid() ||
    !deal.restaurantId ||
    !deal.userId
  ) {
    return false;
  }

  //
  return true;
};
exports.isDealValid = isDealValid;

// Checks if deal has recurrence schedules
const hasRecurrenceSchedules = deal => {
  if (deal.recurrenceSchedules?.length > 0) {
    return true;
  }

  return false;
}
exports.hasRecurrenceSchedules = hasRecurrenceSchedules;
