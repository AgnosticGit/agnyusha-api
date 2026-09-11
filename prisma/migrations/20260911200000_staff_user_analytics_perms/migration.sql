-- Add staff permissions that replace the MANAGER role gates.
ALTER TYPE "StaffPermission" ADD VALUE 'USER_MANAGE';
ALTER TYPE "StaffPermission" ADD VALUE 'ANALYTICS_VIEW';
