# Mission Control Authentication

This document describes the authentication system for Mission Control, powered by Supabase.

## Overview

Mission Control uses Supabase for authentication with role-based access control (RBAC):

- **Admin**: Full access - can view, create, edit, delete tickets and manage users
- **Editor**: Can view, create, and edit tickets
- **Viewer**: Read-only access to view tickets

## Setup

### 1. Supabase Configuration

The Supabase project is already configured. Environment variables are set in `docker-compose.yml`:

- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_ANON_KEY`: Public anon key (for frontend)
- `SUPABASE_SERVICE_KEY`: Service role key (for backend admin operations)

### 2. Database Setup

Run the migration script in Supabase SQL Editor:

```sql
-- Located at: supabase/migrations/001_user_roles.sql
```

This creates:
- `user_roles` table with RLS policies
- Automatic role assignment trigger (first user = admin)
- Helper function `get_my_role()`

### 3. First Admin User

1. Sign up via the login page
2. The first user is automatically promoted to `admin`
3. Subsequent users get `viewer` role by default

## API Endpoints

### Authentication

| Endpoint | Method | Auth Required | Role | Description |
|----------|--------|---------------|------|-------------|
| `/api/auth/me` | GET | Yes | Any | Get current user info |
| `/api/auth/users` | GET | Yes | Admin | List all users |
| `/api/auth/users/:id/role` | PATCH | Yes | Admin | Update user role |
| `/api/auth/users/:id` | DELETE | Yes | Admin | Delete a user |
| `/api/auth/invite` | POST | Yes | Admin | Invite user by email |

### Tickets (Protected)

| Endpoint | Method | Auth Required | Role | Description |
|----------|--------|---------------|------|-------------|
| `/api/tickets` | GET | Yes | Any | List tickets |
| `/api/tickets/:id` | GET | Yes | Any | Get ticket |
| `/api/tickets` | POST | Yes | Editor+ | Create ticket |
| `/api/tickets/:id` | PATCH | Yes | Editor+ | Update ticket |
| `/api/tickets/:id` | DELETE | Yes | Admin | Delete ticket |
| `/api/tickets/:id/move` | PATCH | Yes | Editor+ | Move ticket status |
| `/api/tickets/:id/groom` | POST | Yes | Editor+ | Trigger grooming |

## WebSocket Authentication

WebSocket connections require authentication via the `auth.token` handshake option:

```typescript
const socket = io(WS_URL, {
  auth: {
    token: session.access_token,
  },
});
```

Unauthenticated connections are rejected with `Authentication required` error.

## Frontend Integration

### Auth Context

The `AuthContext` provides:
- `user`: Current Supabase user
- `session`: Current session (includes access_token)
- `role`: User's role (admin/editor/viewer)
- `loading`: Auth loading state
- `signIn()`, `signUp()`, `signOut()`: Auth methods
- `canEdit`, `canDelete`: Permission helpers

### Protected Routes

Wrap routes with `<ProtectedRoute>`:

```tsx
<ProtectedRoute>
  <Dashboard />
</ProtectedRoute>

// Or require specific role:
<ProtectedRoute requiredRole="admin">
  <AdminPanel />
</ProtectedRoute>
```

### Role-Based UI

Use `useAuth()` hook to conditionally render UI elements:

```tsx
const { canEdit, canDelete } = useAuth();

return (
  <>
    {canEdit && <EditButton />}
    {canDelete && <DeleteButton />}
  </>
);
```

## Token Refresh

Supabase handles token refresh automatically. The `onAuthStateChange` listener updates the session when tokens refresh.

If an API call returns 401, the frontend signs out and redirects to login.

## Security Considerations

1. **Service Key**: Never expose `SUPABASE_SERVICE_KEY` in frontend code
2. **RLS Policies**: Database-level security ensures users can only access their own role
3. **Role Caching**: Role changes take effect immediately on next API call
4. **CORS**: Configure allowed origins in `CORS_ORIGIN` env var
