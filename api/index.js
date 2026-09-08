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
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {

    // =========================================
    // HEALTH CHECK
    // =========================================

    if (
  req.method === "GET" &&
  !req.query?.test &&
  !req.query?.action
) {
      return res.status(200).json({
        success: true,
        message: "Dice Traders Custom Reviews API is running.",
      });
    }


    // =========================================
    // SHOPIFY TEST
    // =========================================

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


    // =========================================
    // CREATE UPLOAD TARGET
    // =========================================

    if (
      req.method === "POST" &&
      req.query?.action === "upload-target"
    ) {

      const {
        filename,
        mimeType
      } = req.body || {};

      if (!filename || !mimeType) {
        return res.status(400).json({
          success: false,
          message:
            "filename and mimeType are required.",
        });
      }

      if (!mimeType.startsWith("image/")) {
        return res.status(400).json({
          success: false,
          message:
            "Only image files are allowed.",
        });
      }

      const uploadData =
        await shopifyGraphQL(
          `
          mutation CreateUploadTarget(
            $input: [StagedUploadInput!]!
          ) {
            stagedUploadsCreate(
              input: $input
            ) {

              stagedTargets {
                url
                resourceUrl

                parameters {
                  name
                  value
                }
              }

              userErrors {
                field
                message
              }
            }
          }
          `,
          {
            input: [
              {
                filename: String(filename),
                mimeType: String(mimeType),
                httpMethod: "POST",
                resource: "FILE"
              }
            ]
          }
        );

      const result =
        uploadData.data.stagedUploadsCreate;

      if (result.userErrors?.length) {
        return res.status(400).json({
          success: false,
          message:
            "Could not create upload target.",
          errors: result.userErrors
        });
      }

      return res.status(200).json({
        success: true,
        target: result.stagedTargets[0]
      });
    }


    // =========================================
    // CREATE SHOPIFY FILE
    // =========================================

    if (
      req.method === "POST" &&
      req.query?.action === "create-file"
    ) {

      const {
        resourceUrl,
        alt
      } = req.body || {};

      if (!resourceUrl) {
        return res.status(400).json({
          success: false,
          message:
            "resourceUrl is required.",
        });
      }

      const fileData =
        await shopifyGraphQL(
          `
          mutation CreateFile(
            $files: [FileCreateInput!]!
          ) {

            fileCreate(
              files: $files
            ) {

              files {
                id
                fileStatus
                alt
                createdAt
              }

              userErrors {
                field
                message
              }
            }
          }
          `,
          {
            files: [
              {
                alt:
                  String(
                    alt ||
                    "Customer review photo"
                  ),

                contentType:
                  "IMAGE",

                originalSource:
                  String(resourceUrl)
              }
            ]
          }
        );

      const result =
        fileData.data.fileCreate;

      if (result.userErrors?.length) {
        return res.status(400).json({
          success: false,
          message:
            "Shopify file could not be created.",
          errors: result.userErrors
        });
      }

      return res.status(200).json({
        success: true,
        file: result.files[0]
      });
    }


    // =========================================
    // SAVE CUSTOMER REVIEW
    // =========================================

    if (
      req.method === "POST" &&
      req.query?.action === "submit-review"
    ) {

      const body = req.body || {};

      const productId =
        body.product_id;

      const customerName =
        String(
          body.customer_name || ""
        ).trim();

      const rating =
        Number(body.rating);

      const reviewText =
        String(
          body.review || ""
        ).trim();

      const imageIds =
        Array.isArray(body.image_ids)
          ? body.image_ids
          : [];


      // ---------------------------------------
      // VALIDATION
      // ---------------------------------------

      if (!productId) {
        return res.status(400).json({
          success: false,
          message:
            "Product ID is required.",
        });
      }

      if (!customerName) {
        return res.status(400).json({
          success: false,
          message:
            "Customer name is required.",
        });
      }

      if (
        !Number.isInteger(rating) ||
        rating < 1 ||
        rating > 5
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Rating must be between 1 and 5.",
        });
      }

      if (!reviewText) {
        return res.status(400).json({
          success: false,
          message:
            "Review text is required.",
        });
      }

      if (imageIds.length > 6) {
        return res.status(400).json({
          success: false,
          message:
            "Maximum 6 photos are allowed.",
        });
      }


      // ---------------------------------------
      // BUILD REVIEW FIELDS
      // ---------------------------------------

      const now =
        new Date().toISOString();

      const fields = [

        {
          key: "product",
          value: String(productId)
        },

        {
          key: "customer_name",
          value: customerName
        },

        {
          key: "rating",
          value: String(rating)
        },

        {
          key: "review",
          value: reviewText
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

      ];


      // ---------------------------------------
      // ADD PHOTOS
      // ---------------------------------------

      if (imageIds.length > 0) {

        fields.push({
          key: "images",
          value: JSON.stringify(
            imageIds.map(
              id => String(id)
            )
          )
        });
      }


      // ---------------------------------------
      // CREATE METAOBJECT
      // ---------------------------------------

      const reviewData =
        await shopifyGraphQL(
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
              }
            }
          }
          `,
          {
            metaobject: {
              type: "$app:review",
              fields: fields
            }
          }
        );


      const result =
        reviewData.data.metaobjectCreate;


      if (result.userErrors?.length) {

        return res.status(400).json({
          success: false,
          message:
            "Review could not be saved.",
          errors:
            result.userErrors
        });
      }


      // ---------------------------------------
      // SUCCESS
      // ---------------------------------------

      return res.status(201).json({

        success: true,

        message:
          "Review submitted successfully! It is awaiting approval.",

        review:
          result.metaobject

      });
    }
    // =========================================
// GET APPROVED REVIEWS FOR STOREFRONT
// =========================================

if (
  req.method === "GET" &&
  req.query?.action === "storefront-reviews"
) {
  const productId = String(
    req.query?.product_id || ""
  ).trim();

  if (!productId) {
    return res.status(400).json({
      success: false,
      message: "Product ID is required."
    });
  }

  const reviewData = await shopifyGraphQL(`
    query GetStorefrontReviews {
      metaobjects(
        type: "$app:review"
        first: 100
      ) {
        nodes {
          id
          fields {
            key
            value
          }
        }
      }
    }
  `);

  const reviews =
    reviewData.data.metaobjects.nodes
      .map(function(review) {
        const fields = {};

        review.fields.forEach(function(field) {
          fields[field.key] = field.value;
        });

        return {
          id: review.id,
          product_id: fields.product || "",
          customer_name: fields.customer_name || "",
          rating: Number(fields.rating || 0),
          review: fields.review || "",
          review_date: fields.review_date || "",
          status: fields.status || "pending",
          verified: fields.verified === "true",
          images: fields.images
            ? JSON.parse(fields.images)
            : []
        };
      })
      .filter(function(review) {
        return (
          review.product_id === productId &&
          review.status === "approved"
        );
      });

  return res.status(200).json({
    success: true,
    reviews: reviews
  });
}
    // =========================================
// GET REVIEWS FOR ADMIN
// =========================================

if (
  req.method === "GET" &&
  req.query?.action === "admin-reviews"
) {

  // ---------------------------------------
  // ADMIN AUTHENTICATION
  // ---------------------------------------

  const adminKey = req.headers["x-admin-key"];

  if (
    !adminKey ||
    adminKey !== process.env.ADMIN_KEY
  ) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized."
    });
  }

  // ---------------------------------------
  // GET REVIEWS
  // ---------------------------------------

  const reviewData = await shopifyGraphQL(`
    query GetCustomerReviews {
      metaobjects(
        type: "$app:review"
        first: 100
      ) {
        nodes {
          id
          handle
          type
          fields {
            key
            value
          }
        }
      }
    }
  `);
console.log(
  "ADMIN REVIEWS SHOPIFY RESPONSE:",
  JSON.stringify(reviewData, null, 2)
);
  const reviews =
    reviewData.data.metaobjects.nodes.map(
      function(review) {

        const fields = {};

        review.fields.forEach(
          function(field) {
            fields[field.key] = field.value;
          }
        );

        return {
          id: review.id,
          handle: review.handle,
          product_id: fields.product || "",
          customer_name: fields.customer_name || "",
          rating: Number(fields.rating || 0),
          review: fields.review || "",
          review_date: fields.review_date || "",
          status: fields.status || "pending",
          verified:
            fields.verified === "true"
        };

      }
    );

  return res.status(200).json({
    success: true,
    reviews: reviews
  });
}
// =========================================
// REVIEW MODERATION
// =========================================

if (
  req.method === "POST" &&
  req.query?.action === "update-status"
) {

  const body = req.body || {};
// ---------------------------------------
// ADMIN AUTHENTICATION
// ---------------------------------------

const adminKey = req.headers["x-admin-key"];

if (
  !adminKey ||
  adminKey !== process.env.ADMIN_KEY
) {
  return res.status(401).json({
    success: false,
    message: "Unauthorized."
  });
}
  const reviewId = String(
    body.review_id || ""
  ).trim();

  const status = String(
    body.status || ""
  ).trim().toLowerCase();


  // ---------------------------------------
  // VALIDATION
  // ---------------------------------------

  if (!reviewId) {
    return res.status(400).json({
      success: false,
      message: "Review ID is required."
    });
  }

  if (
    status !== "approved" &&
    status !== "rejected" &&
    status !== "pending"
  ) {
    return res.status(400).json({
      success: false,
      message:
        "Status must be approved, rejected, or pending."
    });
  }


  // ---------------------------------------
  // UPDATE SHOPIFY METAOBJECT
  // ---------------------------------------

  const updateData = await shopifyGraphQL(
    `
      mutation UpdateReviewStatus(
        $id: ID!,
        $metaobject: MetaobjectUpdateInput!
      ) {

        metaobjectUpdate(
          id: $id,
          metaobject: $metaobject
        ) {

          metaobject {
            id
            handle

            field(key: "status") {
              value
            }
          }

          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      id: reviewId,

      metaobject: {
        fields: [
          {
            key: "status",
            value: status
          }
        ]
      }
    }
  );


  const result =
    updateData.data.metaobjectUpdate;


  // ---------------------------------------
  // SHOPIFY ERRORS
  // ---------------------------------------

  if (result.userErrors?.length) {

    return res.status(400).json({
      success: false,
      message:
        "Could not update review status.",
      errors:
        result.userErrors
    });

  }


  // ---------------------------------------
  // SUCCESS
  // ---------------------------------------

  return res.status(200).json({

    success: true,

    message:
      `Review ${status} successfully.`,

    review:
      result.metaobject

  });
}

    // =========================================
    // METHOD NOT ALLOWED
    // =========================================

    return res.status(405).json({
      success: false,
      message: "Method not allowed.",
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({

      success: false,

      message:
        error.message ||
        "Server error."

    });
  }
}
