#include "PhysicsEngine.h"
#include <cmath>

namespace Physics {

RigidBody::RigidBody()
    : position(Vector2(0, 0))
    , velocity(Vector2(0, 0))
    , acceleration(Vector2(0, 0))
    , force(Vector2(0, 0))
    , mass(1.0f)
    , invMass(1.0f)
    , restitution(0.6f)
    , friction(0.2f)
    , isStatic(false)
    , shapeType(ShapeType::BOX)
    , size(Vector2(50, 50))
    , radius(25.0f)
    , color({255, 255, 255, 255})
{
}

void RigidBody::ApplyForce(const Vector2& f) {
    if (isStatic) return;
    force += f;
}

void RigidBody::Update(float dt, const Vector2& gravity) {
    if (isStatic) return;

    acceleration = force * invMass;
    acceleration += gravity;

    velocity += acceleration * dt;
    position += velocity * dt;

    force = Vector2(0, 0);
}

AABB RigidBody::GetAABB() const {
    if (shapeType == ShapeType::BOX) {
        Vector2 halfSize = size * 0.5f;
        return AABB(position - halfSize, position + halfSize);
    } else {
        return AABB(
            Vector2(position.x - radius, position.y - radius),
            Vector2(position.x + radius, position.y + radius)
        );
    }
}

void RigidBody::Draw(SDL_Renderer* renderer) const {
    SDL_SetRenderDrawColor(renderer, color.r, color.g, color.b, color.a);

    if (shapeType == ShapeType::BOX) {
        Vector2 halfSize = size * 0.5f;
        SDL_Rect rect = {
            static_cast<int>(position.x - halfSize.x),
            static_cast<int>(position.y - halfSize.y),
            static_cast<int>(size.x),
            static_cast<int>(size.y)
        };
        SDL_RenderFillRect(renderer, &rect);

        SDL_SetRenderDrawColor(renderer, 0, 0, 0, 255);
        SDL_RenderDrawRect(renderer, &rect);
    } else {
        int x0 = static_cast<int>(position.x);
        int y0 = static_cast<int>(position.y);
        int r = static_cast<int>(radius);

        int x = r;
        int y = 0;
        int err = 1 - x;

        while (x >= y) {
            SDL_RenderDrawLine(renderer, x0 - x, y0 + y, x0 + x, y0 + y);
            SDL_RenderDrawLine(renderer, x0 - y, y0 + x, x0 + y, y0 + x);
            SDL_RenderDrawLine(renderer, x0 - x, y0 - y, x0 + x, y0 - y);
            SDL_RenderDrawLine(renderer, x0 - y, y0 - x, x0 + y, y0 - x);

            y++;
            if (err < 0) {
                err += 2 * y + 1;
            } else {
                x--;
                err += 2 * (y - x) + 1;
            }
        }

        SDL_SetRenderDrawColor(renderer, 0, 0, 0, 255);
        x = r;
        y = 0;
        err = 1 - x;

        while (x >= y) {
            SDL_RenderDrawPoint(renderer, x0 + x, y0 + y);
            SDL_RenderDrawPoint(renderer, x0 + y, y0 + x);
            SDL_RenderDrawPoint(renderer, x0 - y, y0 + x);
            SDL_RenderDrawPoint(renderer, x0 - x, y0 + y);
            SDL_RenderDrawPoint(renderer, x0 - x, y0 - y);
            SDL_RenderDrawPoint(renderer, x0 - y, y0 - x);
            SDL_RenderDrawPoint(renderer, x0 + y, y0 - x);
            SDL_RenderDrawPoint(renderer, x0 + x, y0 - y);

            y++;
            if (err < 0) {
                err += 2 * y + 1;
            } else {
                x--;
                err += 2 * (y - x) + 1;
            }
        }
    }
}

bool RigidBody::ContainsPoint(const Vector2& point) const {
    if (shapeType == ShapeType::BOX) {
        AABB aabb = GetAABB();
        return point.x >= aabb.min.x && point.x <= aabb.max.x &&
               point.y >= aabb.min.y && point.y <= aabb.max.y;
    } else {
        Vector2 dist = point - position;
        return dist.LengthSquared() <= radius * radius;
    }
}

void RigidBody::SetStatic(bool s) {
    isStatic = s;
    if (s) {
        invMass = 0.0f;
    } else {
        if (mass > 0.0f) {
            invMass = 1.0f / mass;
        } else {
            invMass = 0.0f;
            isStatic = true;
        }
    }
}

void RigidBody::SetPosition(const Vector2& pos) {
    position = pos;
}

Vector2 RigidBody::GetHalfExtents() const {
    if (shapeType == ShapeType::BOX) {
        return size * 0.5f;
    } else {
        return Vector2(radius, radius);
    }
}

AABB RigidBody::GetAABBAt(const Vector2& pos) const {
    Vector2 halfExtents = GetHalfExtents();
    return AABB(pos - halfExtents, pos + halfExtents);
}

AABB RigidBody::GetSweptAABB(const Vector2& displacement) const {
    AABB startAABB = GetAABB();
    AABB endAABB = GetAABBAt(position + displacement);
    return AABB::Merge(startAABB, endAABB);
}

}
