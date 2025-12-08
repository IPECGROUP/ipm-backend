-- CreateTable
CREATE TABLE "CurrencyType" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurrencyType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurrencySource" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurrencySource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CurrencyType_title_key" ON "CurrencyType"("title");

-- CreateIndex
CREATE UNIQUE INDEX "CurrencySource_title_key" ON "CurrencySource"("title");
