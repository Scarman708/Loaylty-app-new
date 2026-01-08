// server.ts
import express from "express";
import { createRequestHandler } from "@remix-run/express";

const app = express();

/* 🔑 THIS FIXES OAUTH COOKIE ISSUE */
app.set("trust proxy", 1);

app.use(express.static("public"));

app.all(
  "*",
  createRequestHandler({
    build: require("./build"),
    mode: process.env.NODE_ENV,
  })
);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
