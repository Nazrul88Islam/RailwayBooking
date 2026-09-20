export const RAILWAY_SELECTORS = {
  // Search Form Elements
  fromStationInput: [
    'input[placeholder="From Station"]',
    'input[placeholder*="From"]',
    'input[name="from_city"]',
    'input#from_city',
    '#dest_from',
    '.select2-search__field'
  ],
  toStationInput: [
    'input[placeholder="To Station"]',
    'input[placeholder*="To"]',
    'input[name="to_city"]',
    'input#to_city',
    '#dest_to'
  ],
  datePickerInput: [
    'input[placeholder="Pick a date"]',
    'input[placeholder*="date"]',
    'input[name="date_of_journey"]',
    'input#date_of_journey',
    '.datepicker-input',
    '#doj'
  ],
  seatClassSelect: [
    'select[name="seat_class"]',
    'select#seat_class',
    '.seat-class-select',
    'select[name="class"]',
    'select'
  ],
  searchButton: [
    'button:not([disabled])',
    'button[type="submit"]',
    '.search-btn',
    '.btn-booking-search',
    'button.search-train-btn',
    'input[type="submit"]'
  ],

  // Train Search Results
  trainCards: [
    '.train-item',
    '.train-card',
    '.single-train-details',
    '.search-result-item'
  ],
  trainTitle: [
    '.train-name',
    '.train-title',
    'h4',
    'h5',
    '.name'
  ],
  bookNowButton: [
    '.btn-book-now',
    'button.book-now',
    'a.book-now-btn',
    '.book-seat-btn'
  ],

  // Seat Map & Selection
  seatMapContainer: [
    '.seat-layout',
    '.seat-plan',
    '#seat_map',
    '.coach-seat-layout'
  ],
  seatItems: [
    '.seat',
    '.seat-item',
    '.seat-available',
    '.coach-seat-btn'
  ],
  continueButton: [
    '.btn-continue',
    'button.continue-btn',
    '.proceed-btn',
    'button[type="submit"].btn-success'
  ],

  // Safety Halts (Human Intervention Points)
  captchaContainer: [
    '#captcha',
    '.g-recaptcha',
    'iframe[src*="captcha"]',
    '.h-captcha'
  ],
  otpContainer: [
    '.otp-input',
    '#otp',
    'input[name="otp"]',
    '.otp-verification-modal'
  ],
  paymentContainer: [
    '.bkash-payment',
    '.nagad-payment',
    'iframe[src*="payment"]',
    '#payment_gateway',
    '.payment-form'
  ]
};
