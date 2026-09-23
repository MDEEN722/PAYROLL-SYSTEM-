function createReference() {
  return "MOCK-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

async function payWorker(worker, amount) {
  return {
    success: true,
    reference: createReference(),
    amount,
    currency: "NGN",
    message: "Mock payment accepted. No real money was transferred."
  };
}

module.exports = { payWorker };
