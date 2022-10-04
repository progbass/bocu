const dayjs = require("dayjs");

// Config
exports.DEAL_EXPIRY_DEFAULT_OFFSET_HOURS = 2;
const DEAL_USAGE_ILIMITED = -1;
exports.DEAL_USAGE_ILIMITED = DEAL_USAGE_ILIMITED;

const doesDealHasRedemptionUsage = (deal) => {
  if (deal.useMax != DEAL_USAGE_ILIMITED) {
    if (deal.useCount >= deal.useMax) {
      return false;
    }
  }

  return true;
};
exports.doesDealHasRedemptionUsage = doesDealHasRedemptionUsage;

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

  // Check expiry date
  const now = dayjs();
  if (now.isAfter(deal.expiresAt.toDate())) {
    return false;
  }

  return true;
};

//
const isDealValid = (deal) => {
  // Check that dates are valid.
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
