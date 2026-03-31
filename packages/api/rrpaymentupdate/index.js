function main(event) {
  return {
    statusCode: 200,
    body: {
      ok: true,
      message: "rrpaymentupdate reached",
      event
    }
  };
}

exports.main = main;