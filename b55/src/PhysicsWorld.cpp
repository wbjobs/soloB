#include "PhysicsEngine.h"
#include <random>

namespace Physics {

PhysicsWorld::PhysicsWorld(const Vector2& gravity) : gravity(gravity) {}

RigidBody* PhysicsWorld::AddBox(float width, float height, float x, float y, float mass) {
    auto body = std::make_unique<RigidBody>();
    body->shapeType = ShapeType::BOX;
    body->size = Vector2(width, height);
    body->position = Vector2(x, y);
    body->mass = mass;
    body->invMass = mass > 0.0f ? 1.0f / mass : 0.0f;
    body->isStatic = mass <= 0.0f;
    body->restitution = 0.6f;
    body->friction = 0.3f;

    static std::random_device rd;
    static std::mt19937 gen(rd());
    static std::uniform_int_distribution<int> colorDist(50, 200);

    body->color.r = static_cast<Uint8>(colorDist(gen));
    body->color.g = static_cast<Uint8>(colorDist(gen));
    body->color.b = static_cast<Uint8>(colorDist(gen));
    body->color.a = 255;

    RigidBody* ptr = body.get();
    bodies.push_back(std::move(body));
    return ptr;
}

RigidBody* PhysicsWorld::AddCircle(float radius, float x, float y, float mass) {
    auto body = std::make_unique<RigidBody>();
    body->shapeType = ShapeType::CIRCLE;
    body->radius = radius;
    body->position = Vector2(x, y);
    body->mass = mass;
    body->invMass = mass > 0.0f ? 1.0f / mass : 0.0f;
    body->isStatic = mass <= 0.0f;
    body->restitution = 0.7f;
    body->friction = 0.2f;

    static std::random_device rd;
    static std::mt19937 gen(rd());
    static std::uniform_int_distribution<int> colorDist(100, 220);

    body->color.r = static_cast<Uint8>(colorDist(gen));
    body->color.g = static_cast<Uint8>(colorDist(gen));
    body->color.b = static_cast<Uint8>(colorDist(gen));
    body->color.a = 255;

    RigidBody* ptr = body.get();
    bodies.push_back(std::move(body));
    return ptr;
}

void PhysicsWorld::AddStaticBox(float width, float height, float x, float y) {
    RigidBody* body = AddBox(width, height, x, y, 0.0f);
    body->SetStatic(true);
    body->color = {100, 100, 100, 255};
}

namespace {

float GetMaxSafeStep(RigidBody* body) {
    Vector2 halfExtents = body->GetHalfExtents();
    float minExtent = std::min(halfExtents.x, halfExtents.y);
    float safeFraction = 0.2f;
    return minExtent * safeFraction;
}

float GetDisplacementPerStep(RigidBody* body, float dt, const Vector2& gravity) {
    if (body->isStatic) return 0.0f;

    Vector2 acceleration = body->force * body->invMass + gravity;
    Vector2 predictedVel = body->velocity + acceleration * dt;
    Vector2 displacement = predictedVel * dt;

    return std::max(std::abs(displacement.x), std::abs(displacement.y));
}

int CalculateRequiredSubsteps(RigidBody* body, float dt, const Vector2& gravity) {
    if (body->isStatic) return 1;

    float maxSafeStep = GetMaxSafeStep(body);
    float predictedDisplacement = GetDisplacementPerStep(body, dt, gravity);

    if (predictedDisplacement <= maxSafeStep) {
        return 1;
    }

    float required = std::ceil(predictedDisplacement / maxSafeStep);
    return static_cast<int>(std::min(required, 128.0f));
}

}

void PhysicsWorld::Step(float dt) {
    int maxSubsteps = 1;
    for (auto& body : bodies) {
        int substeps = CalculateRequiredSubsteps(body.get(), dt, gravity);
        if (substeps > maxSubsteps) {
            maxSubsteps = substeps;
        }
    }

    if (maxSubsteps > 1) {
        maxSubsteps = std::max(maxSubsteps, 8);
    } else {
        maxSubsteps = 8;
    }

    float subDt = dt / static_cast<float>(maxSubsteps);

    for (int iter = 0; iter < maxSubsteps; ++iter) {
        for (auto& body : bodies) {
            if (body->isStatic) continue;

            Vector2 prevPos = body->position;
            Vector2 prevVel = body->velocity;

            body->Update(subDt, gravity);

            Vector2 displacement = body->position - prevPos;
            Vector2 halfExtents = body->GetHalfExtents();
            float maxDisplacement = std::max(std::abs(displacement.x), std::abs(displacement.y));
            float minExtent = std::min(halfExtents.x, halfExtents.y);

            if (maxDisplacement > minExtent * 0.5f) {
                CollisionDetector::ContinuousCollisionInfo earliestHit;
                earliestHit.t = 1.0f;

                for (auto& other : bodies) {
                    if (body.get() == other.get()) continue;
                    if (!other->isStatic) continue;

                    auto hit = CollisionDetector::CheckContinuousCollision(body.get(), displacement, other.get());
                    if (hit.hasCollision && hit.t < earliestHit.t) {
                        earliestHit = hit;
                    }
                }

                if (earliestHit.hasCollision && earliestHit.t < 1.0f) {
                    float t = earliestHit.t;
                    t = std::max(0.0f, t - 0.001f);

                    body->position = prevPos + displacement * t;
                    body->velocity = prevVel * t;

                    Vector2 remainingDisp = displacement * (1.0f - t);
                    Vector2 projectedDisp = remainingDisp - earliestHit.normal * remainingDisp.Dot(earliestHit.normal);
                    body->position += projectedDisp * 0.5f;

                    float velAlongNormal = body->velocity.Dot(earliestHit.normal);
                    if (velAlongNormal < 0.0f) {
                        float e = std::min(body->restitution, earliestHit.bodyB->restitution);
                        body->velocity -= earliestHit.normal * (1.0f + e) * velAlongNormal;
                    }
                }
            }
        }

        for (size_t i = 0; i < bodies.size(); ++i) {
            for (size_t j = i + 1; j < bodies.size(); ++j) {
                RigidBody* a = bodies[i].get();
                RigidBody* b = bodies[j].get();

                auto info = CollisionDetector::CheckCollision(a, b);
                if (info.hasCollision) {
                    CollisionDetector::ResolveCollision(info);
                    CollisionDetector::ApplyFriction(info);
                }
            }
        }
    }
}

void PhysicsWorld::Clear() {
    bodies.clear();
}

RigidBody* PhysicsWorld::GetBodyAtPoint(const Vector2& point) {
    for (auto it = bodies.rbegin(); it != bodies.rend(); ++it) {
        if ((*it)->ContainsPoint(point)) {
            return it->get();
        }
    }
    return nullptr;
}

const std::vector<std::unique_ptr<RigidBody>>& PhysicsWorld::GetBodies() const {
    return bodies;
}

}
