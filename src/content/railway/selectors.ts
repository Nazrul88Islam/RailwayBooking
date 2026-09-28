export const RAILWAY_SELECTORS = {
  // Search Form Elements — BD Railway is an Angular SPA.
  // Confirmed real placeholders from live site inspection:
  //   From input  → placeholder="From Station"
  //   To input    → placeholder="To Station"
  //   Date input  → placeholder="Pick a date"
  //   Class       → <select> with option "Choose Class"
  fromStationInput: [
    'input[placeholder="From Station"]',   // ← confirmed real placeholder
    'input[placeholder="From"]',
    'input[placeholder*="From"]',
    'input[formcontrolname="fromCity"]',
    'input[formcontrolname="from_city"]',
    'input[formcontrolname="fromStation"]',
    'input[id*="from"]',
    'input[name="from_city"]',
    'input#from_city',
    '#dest_from',
    'app-train-search input:first-of-type',
    '.select2-search__field'
  ],
  toStationInput: [
    'input[placeholder="To Station"]',     // ← confirmed real placeholder
    'input[placeholder="To"]',
    'input[placeholder*="To"]',
    'input[formcontrolname="toCity"]',
    'input[formcontrolname="to_city"]',
    'input[formcontrolname="toStation"]',
    'input[id*="to"]',
    'input[name="to_city"]',
    'input#to_city',
    '#dest_to'
  ],
  datePickerInput: [
    'input[placeholder="Pick a date"]',    // ← confirmed real placeholder
    'input[placeholder="Journey Date"]',
    'input[placeholder*="date"]',
    'input[placeholder*="Date"]',
    'input[formcontrolname="journeyDate"]',
    'input[formcontrolname="date_of_journey"]',
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
    'select[formcontrolname="seatClass"]',
    'select[formcontrolname="seat_class"]',
    'select'
  ],
  searchButton: [
    'button[type="submit"]',
    '.search-btn',
    '.btn-booking-search',
    'button.search-train-btn',
    'input[type="submit"]'
  ],
  // Angular autocomplete/dropdown suggestion selectors
  autocompleteOption: [
    'mat-option',
    'mat-option .mat-option-text',
    'ng-option',
    '.ng-option',
    '.mat-autocomplete-panel mat-option',
    'cdk-option',
    '.autocomplete-item',
    '.ui-autocomplete li',
    '.pac-item',
    '[class*="autocomplete"] li',
    '[class*="suggestion"]',
    '.select2-results__option',
    '.ui-menu-item',
    '[class*="option"]:not(select)',
    'li[role="option"]'
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
