# Lago billing — CF Workers Container
# Rails app serving billing.projectsites.dev
FROM ghcr.io/getlago/api:latest

ENV RAILS_ENV=production
ENV LAGO_FRONT_URL=https://billing.projectsites.dev
ENV LAGO_API_URL=https://billing.projectsites.dev
ENV PORT=3000

EXPOSE 3000
CMD ["bundle", "exec", "rails", "server", "-b", "0.0.0.0", "-p", "3000"]
