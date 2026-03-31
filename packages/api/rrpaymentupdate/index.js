export function main(event) {
  console.log("RRPAYMENTUPDATE HIT");
  console.log("EVENT =", JSON.stringify(event));

  return {
    statusCode: 200,
    body: {
      ok: true,
      message: "rrpaymentupdate reached",
      event
    }
  };
}