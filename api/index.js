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

    // Basic health check
    if (req.method === "GET" && !req.query?.test) {
      return res.status(200).json({
        success: true,
        message: "Dice Traders Custom Reviews API is running.",
      });
    }

    // Shopify connection test
    if (req.method === "GET" && req.query?.test === "shopify") {
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

    // Create Review Metaobject definition
    if (
      req.method === "GET" &&
      req.query?.test === "setup-reviews"
    ) {

      // Check if definition already exists
      const existing = await shopifyGraphQL(`
        query {
          metaobjectDefinitionByType(type: "$app:review") {
            id
            name
            type
          }
        }
      `);

      if (existing.data.metaobjectDefinitionByType) {
        return res.status(200).json({
          success: true,
          message: "Review Metaobject already exists.",
          definition:
            existing.data.metaobjectDefinitionByType,
        });
      }

      // Create definition
      const data = await shopifyGraphQL(
        `
        mutation CreateReviewDefinition(
          $definition: MetaobjectDefinitionCreateInput!
        ) {
          metaobjectDefinitionCreate(
            definition: $definition
          ) {
            metaobjectDefinition {
              id
              name
              type

              access {
                admin
                storefront
              }

              fieldDefinitions {
                name
                key
                type {
                  name
                }
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
          definition: {
            name: "Customer Review",
            type: "$app:review",

            access: {
              admin: "MERCHANT_READ_WRITE",
              storefront: "PUBLIC_READ"
            },

            fieldDefinitions: [
              {
                name: "Product",
                key: "product",
                type: "product_reference"
              },

              {
                name: "Customer Name",
                key: "customer_name",
                type: "single_line_text_field"
              },

              {
                name: "Rating",
                key: "rating",
                type: "number_integer"
              },

              {
                name: "Review",
                key: "review",
                type: "multi_line_text_field"
              },

              {
                name: "Review Date",
                key: "review_date",
                type: "date_time"
              },

              {
                name: "Status",
                key: "status",
                type: "single_line_text_field"
              },

              {
                name: "Verified Buyer",
                key: "verified",
                type: "boolean"
              },

              {
                name: "Customer Photos",
                key: "images",
                type: "list.file_reference"
              }
            ]
          }
        }
      );

      const result =
        data.data.metaobjectDefinitionCreate;

      if (result.userErrors?.length) {
        return res.status(400).json({
          success: false,
          message: "Could not create review definition.",
          errors: result.userErrors
        });
      }

      return res.status(200).json({
        success: true,
        message: "Review Metaobject created successfully!",
        definition: result.metaobjectDefinition
      });
    }

    // Temporary POST test
    if (req.method === "POST") {
      return res.status(200).json({
        success: true,
        message: "Review endpoint is ready.",
      });
    }

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
