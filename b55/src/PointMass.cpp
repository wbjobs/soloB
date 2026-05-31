#include "PhysicsEngine.h"

namespace Physics {

PointMass::PointMass()
    : position(Vector2(0, 0))
    , oldPosition(Vector2(0, 0))
    , velocity(Vector2(0, 0))
    , acceleration(Vector2(0, 0))
    , force(Vector2(0, 0))
    , mass(1.0f)
    , invMass(1.0f)
    , pinned(false)
{
}

PointMass::PointMass(const Vector2& pos, float m, bool pin)
    : position(pos)
    , oldPosition(pos)
    , velocity(Vector2(0, 0))
    , acceleration(Vector2(0, 0))
    , force(Vector2(0, 0))
    , mass(m)
    , invMass(m > 0.0f ? 1.0f / m : 0.0f)
    , pinned(pin)
{
    if (pin) {
        invMass = 0.0f;
    }
}

void PointMass::ApplyForce(const Vector2& f) {
    if (pinned) return;
    force += f;
}

void PointMass::Update(float dt, const Vector2& gravity, float damping) {
    if (pinned) {
        velocity = Vector2(0, 0);
        return;
    }

    acceleration = force * invMass;
    acceleration += gravity;

    velocity += acceleration * dt;
    velocity *= damping;

    oldPosition = position;
    position += velocity * dt;

    force = Vector2(0, 0);
}

void PointMass::SetPinned(bool pin) {
    pinned = pin;
    if (pin) {
        invMass = 0.0f;
        velocity = Vector2(0, 0);
    } else {
        if (mass > 0.0f) {
            invMass = 1.0f / mass;
        } else {
            invMass = 0.0f;
            pinned = true;
        }
    }
}

void PointMass::SetPosition(const Vector2& pos) {
    oldPosition = position;
    position = pos;
}

}
