const dayjs = require("dayjs");
const { DEFAULT_AVERAGE_TICKET } = require("./app-config")

//
const getNewBillingObject = (restaurantId, periodStart, periodEnd, props = {}) => {
  return {
    redemptions: [],
    calculatedBalance: 0,
    manualAdjustment: 0,
    totalBalance: 0,
    paidQuantity: 0,
    debtQuantity: 0,
    isPaid: false,
    paidAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    periodStart,
    periodEnd,

    ...props,
    restaurantId,
  }
}
exports.getNewBillingObject = getNewBillingObject;