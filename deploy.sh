#!/bin/bash
# FloMail GCP Deployment Script
# Usage: ./deploy.sh

set -e

echo "🚀 FloMail GCP Deployment"
echo "========================="

# Check if .env.local exists
if [ ! -f .env.local ]; then
    echo "❌ Error: .env.local file not found"
    exit 1
fi

# Load environment variables
source .env.local

# Validate required variables
required_vars=(
    "NEXT_PUBLIC_FIREBASE_API_KEY"
    "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"
    "NEXT_PUBLIC_FIREBASE_PROJECT_ID"
    "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"
    "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"
    "NEXT_PUBLIC_FIREBASE_APP_ID"
    "OPENAI_API_KEY"
    "ANTHROPIC_API_KEY"
)

for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        echo "❌ Error: $var is not set in .env.local"
        exit 1
    fi
done

echo "✅ Environment variables validated"

# Set project
gcloud config set project flomail25

echo "☁️ Starting Cloud Build (this may take 3-5 minutes)..."

# Run Cloud Build with substitutions
gcloud builds submit \
  --config=cloudbuild.yaml \
  --substitutions="_NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY,_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,_NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID,_NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=$NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,_NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,_NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID,_OPENAI_API_KEY=$OPENAI_API_KEY,_ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY"

# Get the service URL
echo ""
echo "✅ Deployment complete!"
echo ""
echo "🌐 Your app is live at:"
gcloud run services describe flomail --region us-central1 --format="value(status.url)"
