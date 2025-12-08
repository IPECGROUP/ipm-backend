/*
  Warnings:

  - You are about to drop the `Project` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "Project";

-- CreateTable
CREATE TABLE "projects" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(255) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);
