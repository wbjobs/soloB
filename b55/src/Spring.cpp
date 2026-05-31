#include "PhysicsEngine.h"
#include <cmath>

namespace Physics {

Spring::Spring()
    : massA(nullptr)
    , massB(nullptr)
    , restLength(0.0f)
    , stiffness(800.0f)
    , damping(0.9f)
{
}

Spring::Spring(PointMass* a, PointMass* b, float restLen, float stiff, float damp)
    : massA(a)
    , massB(b)
    , restLength(restLen)
    , stiffness(stiff)
    , damping(damp)
{
}

float Spring::GetCurrentLength() const {
    if (!massA || !massB) return 0.0f;
    Vector2 delta = massB->position - massA->position;
    return delta.Length();
}

Vector2 Spring::GetDirection() const {
    if (!massA || !massB) return Vector2(0, 0);
    Vector2 delta = massB->position - massA->position;
    return delta.Normalize();
}

void Spring::ApplyForce() {
    if (!massA || !massB) return;
    if (massA->pinned && massB->pinned) return;

    Vector2 delta = massB->position - massA->position;
    float currentLength = delta.Length();

    if (currentLength < 0.0001f) return;

    Vector2 dir = delta / currentLength;
    float displacement = currentLength - restLength;

    Vector2 springForce = dir * (-stiffness * displacement);

    Vector2 relVel = massB->velocity - massA->velocity;
    float velAlongSpring = relVel.Dot(dir);
    Vector2 dampingForce = dir * (-damping * velAlongSpring);

    Vector2 totalForce = springForce + dampingForce;

    if (!massA->pinned) {
        massA->ApplyForce(-totalForce);
    }

    if (!massB->pinned) {
        massB->ApplyForce(totalForce);
    }
}

}
