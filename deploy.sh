#!/bin/bash

# FloMail - Manual Deployment Script for Cloud Run
# Usage: ./deploy.sh

set -e  # Exit on error

# ============================================
# Configuration
# ============================================
PROJECT_ID="flomail25"
REGION="us-central1"
SERVICE_NAME="flomail"
REPO_NAME="flomail"
IMAGE_NAME="flomail"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 FloMail Deployment Script${NC}"
echo "=================================="

# ============================================
# Pre-flight Checks
# ============================================
echo -e "\n${YELLOW}📋 Pre-flight checks...${NC}"

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}❌ gcloud CLI not found. Install from: https://cloud.google.com/sdk/docs/install${NC}"
    exit 1
fi

# Check if docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker not found. Install from: https://docs.docker.com/get-docker/${NC}"
    exit 1
fi

# Set project
echo "Setting project to $PROJECT_ID..."
gcloud config set project $PROJECT_ID

# ============================================
# Step 1: Create Artifact Registry (if needed)
# ============================================
echo -e "\n${YELLOW}📦 Setting up Artifact Registry...${NC}"
gcloud artifacts repositories describe $REPO_NAME --location=$REGION 2>/dev/null || \
    gcloud artifacts repositories create $REPO_NAME \
        --repository-format=docker \
        --location=$REGION \
        --description="FloMail Docker images"

# Configure Docker auth
gcloud auth configure-docker $REGION-docker.pkg.dev --quiet

# ============================================
# Step 2: Build Docker Image
# ============================================
echo -e "\n${YELLOW}🔨 Building Docker image...${NC}"
IMAGE_URL="$REGION-docker.pkg.dev/$PROJECT_ID/$REPO_NAME/$IMAGE_NAME:latest"

docker build -t $IMAGE_URL .

# ============================================
# Step 3: Push to Artifact Registry
# ============================================
echo -e "\n${YELLOW}📤 Pushing to Artifact Registry...${NC}"
docker push $IMAGE_URL

# ============================================
# Step 4: Deploy to Cloud Run
# ============================================
echo -e "\n${YELLOW}🌐 Deploying to Cloud Run...${NC}"

# Check if .env.local exists for env vars
if [ -f .env.local ]; then
    echo "Found .env.local - extracting environment variables..."
    
    # Read env vars from .env.local (excluding comments and empty lines)
    ENV_VARS=$(grep -v '^#' .env.local | grep -v '^$' | tr '\n' ',' | sed 's/,$//')
    
    gcloud run deploy $SERVICE_NAME \
        --image $IMAGE_URL \
        --region $REGION \
        --platform managed \
        --allow-unauthenticated \
        --timeout 300 \
        --memory 512Mi \
        --cpu 1 \
        --min-instances 0 \
        --max-instances 10 \
        --set-env-vars "$ENV_VARS"
else
    echo -e "${YELLOW}⚠️  No .env.local found - deploying without env vars${NC}"
    echo "You'll need to set environment variables manually in Cloud Console"
    
    gcloud run deploy $SERVICE_NAME \
        --image $IMAGE_URL \
        --region $REGION \
        --platform managed \
        --allow-unauthenticated \
        --timeout 300 \
        --memory 512Mi \
        --cpu 1 \
        --min-instances 0 \
        --max-instances 10
fi

# ============================================
# Step 5: Get Service URL
# ============================================
echo -e "\n${GREEN}✅ Deployment complete!${NC}"
echo "=================================="

SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format='value(status.url)')
echo -e "🌐 Service URL: ${GREEN}$SERVICE_URL${NC}"

echo -e "\n${YELLOW}📝 Next steps:${NC}"
echo "1. Add $SERVICE_URL to Firebase authorized domains"
echo "2. Add $SERVICE_URL/api/auth/callback/google to OAuth redirect URIs"
echo "3. Update NEXTAUTH_URL if using NextAuth"
echo "4. Test the deployment!"

