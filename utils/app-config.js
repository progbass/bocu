// Application Configuration
exports.MAX_CATEGORIES = 2;
exports.MAX_RESTAURANTS_PER_USER = 20;
exports.USER_ROLES = {
    ADMIN: 'admin',
    SUPER_ADMIN: 'super_admin',
    CUSTOMER: 'customer',
    PARTNER: 'partner'
}
exports.SEARCH_CONFIG = {
    MAX_SEARCH_RESULTS_HITS: 100,
    DEFAULT_AROUND_RADIUS: 10000,
    DEFAULT_PAGE: 0
}
exports.LISTING_CONFIG = {
    MAX_LIMIT: 100,
}
exports.HUMAN_READABLE_DATE_FORMAT = 'MMMM D, YYYY, HH:mm A';
