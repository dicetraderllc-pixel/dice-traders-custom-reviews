export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    return res.status(200).json({
      success: true,
      message: "Dice Traders Custom Reviews API is running."
    });
  }

  if (req.method === "POST") {
    return res.status(200).json({
      success: true,
      message: "Review endpoint is ready."
    });
  }

  return res.status(405).json({
    success: false,
    message: "Method not allowed."
  });
}
