# Use the official Node.js 14 image as the base image
FROM node:14

# Set the working directory inside the container
WORKDIR /app

# Copy the package.json and package-lock.json (if available) files to the working directory
COPY package*.json ./

# Install the project dependencies
RUN npm install

# Copy the rest of the application code to the working directory
COPY . .

# Expose a port (if your application listens on a specific port)
EXPOSE 8888

# Use PM2 as the process manager
RUN npm install pm2 -g

# Start the application with PM2
CMD ["pm2-runtime", "ecosystem.config.js"]
