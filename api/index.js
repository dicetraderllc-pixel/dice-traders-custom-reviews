function getShopDomain() {
  let shop = process.env.SHOPIFY_SHOP_DOMAIN || "";

  shop = shop
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .replace(/\.myshopify\.com$/, "");

  return `${shop}.myshopify.com`;
}

async function getShopifyAccessToken() {
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  const shopDomain = getShopDomain();

  if (!clientId || !clientSecret) {
    throw new Error("Shopify credentials are missing.");
  }

  const response = await fetch(
    `https://${shopDomain}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    }
  );

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error(
      `Shopify authentication failed: ${JSON.stringify(data)}`
    );
  }

  return data.access_token;
}

async function shopifyGraphQL(query, variables = {}) {
  const shopDomain = getShopDomain();
  const accessToken = await getShopifyAccessToken();

  const response = await fetch(
    `https://${shopDomain}/admin/api/2026-07/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({
        query,
        variables,
      }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Shopify API HTTP error: ${JSON.stringify(data)}`
    );
  }

  if (data.errors) {
    throw new Error(
      `Shopify GraphQL error: ${JSON.stringify(data.errors)}`
    );
  }

  return data;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {

    // ---------------------------------------
    // BASIC HEALTH CHECK
    // ---------------------------------------

    if (req.method === "GET" && !req.query?.test) {
      return res.status(200).json({
        success: true,
        message: "Dice Traders Custom Reviews API is running.",
      });
    }

    // ---------------------------------------
    // SHOPIFY CONNECTION TEST
    // ---------------------------------------

    if (
      req.method === "GET" &&
      req.query?.test === "shopify"
    ) {
      const data = await shopifyGraphQL(`
        query {
          shop {
            name
            myshopifyDomain
          }

          products(first: 3) {
            nodes {
              id
              title
              handle
            }
          }
        }
      `);

      return res.status(200).json({
        success: true,
        message: "Shopify connection is working!",
        shop: data.data.shop,
        products: data.data.products.nodes,
      });
    }

    // ---------------------------------------
    // TEST: CREATE REVIEW
    // ---------------------------------------

    if (
      req.method === "GET" &&
      req.query?.test === "save-review"
    ) {

      // Get one product automatically
      const productsData = await shopifyGraphQL(`
        query {
          products(first: 1) {
            nodes {
              id
              title
            }
          }
        }
      `);

      const product =
        productsData.data.products.nodes[0];

      if (!product) {
        return res.status(400).json({
          success: false,
          message: "No Shopify product found.",
        });
      }

      const now = new Date().toISOString();

      const reviewData = await shopifyGraphQL(
        `
        mutation CreateReview(
          $metaobject: MetaobjectCreateInput!
        ) {
          metaobjectCreate(
            metaobject: $metaobject
          ) {
            metaobject {
              id
              handle
              type
              fields {
                key
                value
              }
            }

            userErrors {
              field
              message
              code
            }
          }
        }
        `,
        {
          metaobject: {
            type: "$app:review",

            fields: [
              {
                key: "product",
                value: product.id
              },
              {
                key: "customer_name",
                value: "Test Customer"
              },
              {
                key: "rating",
                value: "5"
              },
              {
                key: "review",
                value:
                  "This is a test review from the custom review system."
              },
              {
                key: "review_date",
                value: now
              },
              {
                key: "status",
                value: "pending"
              },
              {
                key: "verified",
                value: "false"
              }
            ]
          }
        }
      );

      const result =
        reviewData.data.metaobjectCreate;

      if (result.userErrors?.length) {
        return res.status(400).json({
          success: false,
          message: "Review could not be created.",
          errors: result.userErrors,
        });
      }

      return res.status(200).json({
        success: true,
        message: "Test review saved successfully!",
        product: product,
        review: result.metaobject,
      });
    }

    // ---------------------------------------
    // REAL REVIEW SUBMISSION
    // ---------------------------------------

    if (req.method === "POST") {

      const body = req.body || {};

      const productId = body.product_id;
      const customerName = body.customer_name;
      const rating = Number(body.rating);
      const reviewText = body.review;

      if (!productId) {
        return res.status(400).json({
          success: false,
          message: "Product ID is required.",
        });
      }

      if (!customerName) {
        return res.status(400).json({
          success: false,
          message: "Customer name is required.",
        });
      }

      if (
        !Number.isInteger(rating) ||
        rating < 1 ||
        rating > 5
      ) {
        return res.status(400).json({
          success: false,
          message: "Rating must be between 1 and 5.",
        });
      }

      if (!reviewText) {
        return res.status(400).json({
          success: false,
          message: "Review text is required.",
        });
      }

      const now = new Date().toISOString();

      const reviewData = await shopifyGraphQL(
        `
        mutation CreateReview(
          $metaobject: MetaobjectCreateInput!
        ) {
          metaobjectCreate(
            metaobject: $metaobject
          ) {
            metaobject {
              id
              handle
              type
              fields {
                key
                value
              }
            }

            userErrors {
              field
              message
              code
            }
          }
        }
        `,
        {
          metaobject: {
            type: "$app:review",

            fields: [
              {
                key: "product",
                value: productId,
              },
              {
                key: "customer_name",
                value: String(customerName).trim(),
              },
              {
                key: "rating",
                value: String(rating),
              },
              {
                key: "review",
                value: String(reviewText).trim(),
              },
              {
                key: "review_date",
                value: now,
              },
              {
                key: "status",
                value: "pending",
              },
              {
                key: "verified",
                value: "false",
              }
            ]
          }
        }
      );

      const result =
        reviewData.data.metaobjectCreate;

      if (result.userErrors?.length) {
        return res.status(400).json({
          success: false,
          message: "Review could not be saved.",
          errors: result.userErrors,
        });
      }

      return res.status(201).json({
        success: true,
        message:
          "Review submitted successfully and is awaiting approval.",
        review: result.metaobject,
      });
    }

    // ---------------------------------------
    // METHOD NOT ALLOWED
    // ---------------------------------------

    return res.status(405).json({
      success: false,
      message: "Method not allowed.",
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      success: false,
      message: error.message || "Server error.",
    });
  }
}
